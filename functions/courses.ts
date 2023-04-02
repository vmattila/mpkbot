
import { populateCourseIndex, findCourses } from './courseindex/courseindex';
import { Handler, Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';

export const getCourses: Handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
  await populateCourseIndex();

  const courses = await findCourses(
    JSON.parse(event.queryStringParameters?.tokens || ""),
  );

  return {
      statusCode: 200,
      body: JSON.stringify({
        courses: courses
      }),
      headers: {
        "Access-Control-Allow-Headers" : "*",
        "Access-Control-Allow-Origin": "*"
    },
  };
};
