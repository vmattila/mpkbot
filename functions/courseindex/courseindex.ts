import { Index } from "flexsearch";
import { scanTable } from "../dynamodb/scan-query-table";
export let courseIndex = new Index({
  tokenize: "forward",
  minlength: 3,
});
export let courseMap = new Map();
export let currentIndexVersion: number = 0;

import * as AWS from "aws-sdk";
const dynamodb = new AWS.DynamoDB();

export const populateCourseIndex = async (force?: boolean) => {
  const lastUpdatedInDb = await checkCourseIndexUpdated();
  if (!force && lastUpdatedInDb && lastUpdatedInDb === currentIndexVersion) {
    console.log(
      `Course index is at version ${lastUpdatedInDb}, no need to refetch.`,
    );
    return;
  }

  currentIndexVersion = lastUpdatedInDb || 0;
  const allData = await scanTable(dynamodb, process.env.COURSES_DYNAMODB_TABLE);

  courseIndex = new Index({
    tokenize: "forward",
    minlength: 3,
  });
  courseMap = new Map();

  for (const doc of allData) {
    courseIndex.add(
      doc.CourseId.N,
      doc.Name?.S + " " + doc.Location?.S + " " + doc.IntroText?.S,
    );
    courseMap.set(doc.CourseId.N, doc);
  }

  console.log(
    `Course index updated ${allData.length} courses, last update ${lastUpdatedInDb}.`,
  );
};

export const triggerCourseIndexUpdated = async () => {
  await dynamodb
    .putItem({
      TableName: process.env.STATUS_DYNAMODB_TABLE,
      Item: {
        StatusKey: { S: "CourseIndexUpdated" },
        UpdatedAt: { N: Date.now().toString() },
      },
    })
    .promise();
  currentIndexVersion = 0;
};

export const checkCourseIndexUpdated = async (): Promise<
  number | undefined
> => {
  const item = await dynamodb
    .getItem({
      AttributesToGet: ["UpdatedAt"],
      TableName: process.env.STATUS_DYNAMODB_TABLE,
      Key: {
        StatusKey: { S: "CourseIndexUpdated" },
      },
    })
    .promise();
  if (item.Item && item.Item.UpdatedAt?.N) {
    return parseInt(item.Item.UpdatedAt?.N, 10);
  } else {
    return undefined;
  }
};

export const findCourses = async (tokens: string[]) => {
  const keywords: string[] = [];
  const notKeywords: string[] = [];
  for (const token of tokens) {
    if (token[0] === "-") {
      notKeywords.push(token.substring(1));
    } else {
      keywords.push(token);
    }
  }

  console.log(
    `findCourses: Tokens ${JSON.stringify(tokens)} -> keywords ${JSON.stringify(keywords)} / not-keywords ${JSON.stringify(notKeywords)}`,
  );

  let results = await courseIndex.searchAsync(keywords.join(" "));

  if (notKeywords && notKeywords.length > 0) {
    const negatedResults = await courseIndex.searchAsync(notKeywords.join(" "));
    results = results.filter((x: any) => !negatedResults.includes(x));
  }

  const courses = [];
  for (const courseId of results) {
    const doc = getCourseJsonById(courseId);
    if (doc) {
      courses.push(doc);
    }
  }

  courses.sort((a, b) => (a.starts_at || 0) - (b.starts_at || 0));

  return courses;
};

export const getCourseJsonById = (courseId: number): any => {
  const doc = courseMap.get(courseId);
  if (!doc) {
    return undefined;
  }
  return {
    id: courseId,
    name: doc.Name?.S,
    location: doc.Location?.S,
    timeinfo: doc.TimeInfo?.S,
    starts_at: doc.StartTime?.N ? parseInt(doc.StartTime?.N, 10) : null,
    ends_at: doc.EndTime?.N ? parseInt(doc.EndTime?.N, 10) : null,
    info: doc.IntroText?.S,
    link: `https://koulutuskalenteri.mpk.fi/Koulutuskalenteri/Tutustu-tarkemmin/id/${courseId}`,
  };
};
