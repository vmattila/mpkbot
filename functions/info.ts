import {
  Handler,
  Context,
  APIGatewayProxyResult,
  APIGatewayEvent,
} from "aws-lambda";

export const showPublicInfo: Handler = async (
  event: APIGatewayEvent,
  context: Context,
): Promise<APIGatewayProxyResult> => {
  console.log(`Event: ${JSON.stringify(event, null, 2)}`);
  console.log(`Context: ${JSON.stringify(context, null, 2)}`);
  return {
    statusCode: 200,
    body: JSON.stringify({
      environment_info: "hello world",
    }),
  };
};
