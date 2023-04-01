import { Index } from 'flexsearch';
import { scanTable } from '../dynamodb/scan-query-table';
export let courseIndex = new Index({
  tokenize: "forward",
  minlength: 3
});
export let courseMap = new Map();

import * as AWS from 'aws-sdk';
const dynamodb = new AWS.DynamoDB();

export const populateCourseIndex = async (force?: boolean) => {
    if (courseMap.size && !force) {
      return;
    }
  
    const allData = await scanTable(dynamodb, process.env.COURSES_DYNAMODB_TABLE);
    
    courseIndex = new Index({
      tokenize: "forward",
      minlength: 3
    });
    courseMap = new Map();
  
    for (const doc of allData) {
      courseIndex.add(doc.CourseId.N, doc.Name?.S + ' ' + doc.IntroText?.S + ' ' + doc.Location?.S);
      courseMap.set(doc.CourseId.N, doc);
    }
    
    console.log(`Course index updated ${allData.length} courses.`);
  }

  
export const findCourses = async (keywords: any, notKeywords: any) => {
  
    let results = await courseIndex.searchAsync(keywords);
  
    if (notKeywords) {
      const negatedResults = await courseIndex.searchAsync(notKeywords);
      results = results.filter((x: any) => !negatedResults.includes(x));
    }
  
    const courses = [];
    for (const courseId of results) {
      const doc = courseMap.get(courseId);
      if (doc) {
        courses.push({
          id: courseId,
          name: doc.Name?.S,
          location: doc.Location?.S,
          timeinfo: doc.TimeInfo?.S,
          starts_at: doc.StartTime?.N ? parseInt(doc.StartTime?.N, 10) : null,
          ends_at: doc.EndTime?.N ? parseInt(doc.EndTime?.N, 10) : null,
          info: doc.IntroText?.S,
          link: `https://koulutuskalenteri.mpk.fi/Koulutuskalenteri/Tutustu-tarkemmin/id/${courseId}`
        });
      }
    }
  
    courses.sort((a,b) => (a.starts_at || 0) - (b.starts_at || 0));
  
    return courses;
  }