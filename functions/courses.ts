
import { populateCourseIndex, findCourses } from './courseindex/courseindex';
import { Handler, Context, APIGatewayProxyResult, APIGatewayEvent } from 'aws-lambda';

export const getCourses: Handler = async (event: APIGatewayEvent, context: Context): Promise<APIGatewayProxyResult> => {
  await populateCourseIndex();

  console.log(event.requestContext.authorizer?.claims.sub);

  const courses = await findCourses(
    event.queryStringParameters?.keywords?.trim(),
    event.queryStringParameters?.not_keywords?.trim(),
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
