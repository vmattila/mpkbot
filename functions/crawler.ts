
import axios from 'axios';
import * as cheerio from 'cheerio';
import moment from 'moment';
import * as AWS from 'aws-sdk';
const dynamodb = new AWS.DynamoDB();
const sqs = new AWS.SQS();
import { Handler } from 'aws-lambda';

import * as crypto from 'crypto';

const crawlCourseListing = async (unitId, startDate, lastCourseId) => {
  const start = startDate.format('DD.MM.YYYY');
  const end = startDate.add(1, 'year').format('DD.MM.YYYY');

  let responseData;
  const url = `https://koulutuskalenteri.mpk.fi/Koulutuskalenteri?&type=search&format=json&group=&unit=&unit_id=${unitId}&sub_unit_id=&organizer_unit_id=&target=&coursetype=&keyword_id=&method=&area=&location=&profile=&status=&nature=&culture=&start=${start}&end=${end}&q=&top=&only_my_events=false&VerkkoKoulutus=false&lisaysAikaleima=false&nayta_Vain_Ilmo_Auki=false`;
  try {
    const response = await axios.get(url);
    responseData = response.data;
  } catch (err) {
    console.error(`HTTP Request (JSON) to ${url} failed: ${err.message}`);
    return;
  }
  
  let lastDate;
  let loopLastCourseId;
  for (const item of responseData) {
   const dateInfo = item.Alkuaika.match(/\/Date\(([0-9]+)\)\//)[0];
   const alkuaika = dateInfo ? moment(dateInfo) : null;

   lastDate = alkuaika || lastDate;
   loopLastCourseId = item.TapahtumaID || loopLastCourseId;

   // Korvataan MPK:n hämärä /Date -arvo Unix Timestampilla
   item.Alkuaika = alkuaika.unix();
   await updateCourseFromJson(item.TapahtumaID, item);
  };

  if (responseData.length == 100) {
    let nextCrawlDate = lastDate;
    if (loopLastCourseId === lastCourseId) {
      console.log(`Got same results back from ${url}, so adding one day to the loop.`);
      nextCrawlDate  = lastDate.add(1, 'day');
    }
    console.log(`Fetching next batch after ${lastDate}`);
    await crawlCourseListing(unitId, nextCrawlDate, loopLastCourseId)
  }
}

const getCourseJsonHash = (courseJsonItem) => {
  // Muunnetaan kurssi-jsonin keyt aakkosiin -> yhtenäinen json
  const itm = Object.keys(courseJsonItem)
    .sort()
    .reduce((acc, key) => {
      acc[key] = courseJsonItem[key];
      return acc;
    }, {});
  return crypto.createHash('sha256').update(JSON.stringify(itm)).digest('hex');
}

const updateCourseFromJson = async (courseId, courseJsonItem) => {
  const jsonHash = getCourseJsonHash(courseJsonItem);

  const courseName = courseJsonItem.Nimi;
  // Tarkistetaan ensin, löytyykö kurssi jo tietokannasta
  const found = await dynamodb.getItem(
    {
      AttributesToGet: [
        "LastCrawledAt",
        "JsonHash",
        "CrawlPending",
      ],
        TableName: process.env.COURSES_DYNAMODB_TABLE,
        Key: {
            CourseId: {N: courseId.toString()},
        }
    }).promise();
  if (found && found.Item) {
      // Kurssi löytyy jo tietokannasta
      if (found.Item.CrawlPending?.BOOL) {
        console.log(`Course ${courseId} ${courseName}, crawl is already pending.`);
      } else if (found.Item.JsonHash?.S !== jsonHash) {
        console.log(`Course ${courseId} ${courseName} hash has changed. Feeding to re-crawl.`);
        await pushToCrawl(courseId, courseJsonItem);
      } else if (found.Item.LastCrawledAt?.N) {
        const lastUpd = moment(parseInt(found.Item.LastCrawledAt.N, 10));
        if (moment().diff(lastUpd, 'hours') > 24) {
          await pushToCrawl(courseId, courseJsonItem);
        } else {
          console.log(`Course ${courseId} ${courseName} is crawled within 24 hours, not crawling again.`);
        }
      } else {
        console.log(`Course ${courseId} ${courseName} is still valid, not re-crawling.`);
      }
  } else {
    await pushToCrawl(courseId, courseJsonItem);
  }
}

const pushToCrawl = async (courseId, courseJsonItem) => {
  console.log(`Course ${courseId} ${courseJsonItem.Nimi} pushing to re-crawl.`);
  await dynamodb.updateItem(
    {
        TableName: process.env.COURSES_DYNAMODB_TABLE,
        Key: {
            CourseId: {N: courseId.toString()},
        },
        UpdateExpression: "set CrawlPending = :val1",
        ExpressionAttributeValues: {
            ":val1": {BOOL: true}
        },
        ReturnValues: "NONE"
    }).promise();

  await sqs.sendMessage({
    MessageBody: JSON.stringify({
      courseId: courseId,
      courseJsonItem: courseJsonItem,
    }),
    QueueUrl: process.env.SQS_CRAWL_QUEUE_URL,
  }).promise();
}

const doCourseCrawl = async (courseId, courseJsonItem) => {
  const jsonHash = getCourseJsonHash(courseJsonItem);
  const response = await axios.get(`https://koulutuskalenteri.mpk.fi/Default.aspx?tabid=1054&id=${courseId}`);
  const responseData = response.data;

  const $ = cheerio.load(responseData);
  const courseName = courseJsonItem.Nimi;
  const ajankohta = $('#product-details table th:contains("Ajankohta") ~ td').text().trim();

  // Koitetaan tulkita loppuaika annetusta formaatista
  const loppuaikaMoment = moment(courseJsonItem.LoppuaikaStr, "D.M.YYYY H.mm", true);
  let loppuaika;
  if (loppuaikaMoment.isValid()) {
    loppuaika = loppuaikaMoment.unix();
  } else {
    loppuaika = null;
  }

  const paikka = $('#product-details table th:contains("Paikkakunta") ~ td').text().trim();

  const tavoite = $('#tabs > #tabs-1 h2:contains("Tavoite") + p').text().trim();
  const soveltuvuus = $('#tabs > #tabs-1 h2:contains("Kenelle kurssi soveltuu") + p').text().trim();
  const esitiedot = $('#tabs > #tabs-1 h2:contains("Esitiedot") + p').text().trim();
  const sis = $('#tabs > #tabs-1 h2:contains("Sisältö") + p').text().trim();
  const hinta = $('#tabs > #tabs-1 h2:contains("Hinta") + p').text().trim();
  const kopa = $('#tabs > #tabs-1 h2:contains("Koulutuspaikka") + p').text().trim();
  const yhteystiedot = $('#tabs > #tabs-1 h2:contains("Yhteystiedot") + p').text().trim();

  const teksti = [tavoite,soveltuvuus,esitiedot,sis].join("\n\n");

  await dynamodb.putItem(
    {
        TableName: process.env.COURSES_DYNAMODB_TABLE,
        Item: {
            CourseId: {N: courseId.toString()},
            LastCrawledAt: {N: Date.now().toString()},
            Name: {S: courseName},
            Location: {S: paikka},
            StartTime: {N: courseJsonItem.Alkuaika.toString()},
            EndTime: loppuaika ? {N: loppuaika.toString()} : {NULL: true},
            TimeInfo: {S: ajankohta},
            IntroText:{S: teksti},
            JsonHash: {S: jsonHash},
            CrawlPending: {BOOL: false},
        }
    }).promise();
  console.log(`Course ${courseId} ${courseName} successfully ingested to DynamoDB`);
}


export const crawl: Handler = async (event) => {
  //await crawlCoursePage(161327);

  const units = [1,2,3,5,10,8,7,22,15,11,12,21,4,6,9,18,20,19,17,16];
  for (const unitId in units) {
    await crawlCourseListing(unitId, moment(), undefined);
  };
};

export const handleSqsCrawlEvent: Handler = async (event) => {
  for (const record of event.Records) {
    console.log(`Message received from the queue`, record);
    const message = JSON.parse(record.body);
    console.log(`Handling message ${record.messageId} from the queue. Course ${message.courseId} ${message.courseJsonItem}`);
    await doCourseCrawl(message.courseId, message.courseJsonItem);
    await sqs.deleteMessage({
      ReceiptHandle: record.receiptHandle,
      QueueUrl: process.env.SQS_CRAWL_QUEUE_URL,
    }).promise();
  }
}



