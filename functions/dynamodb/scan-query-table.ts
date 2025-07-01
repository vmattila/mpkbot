import DynamoDB from "aws-sdk/clients/dynamodb";

export const scanTable = async (dynamodb: AWS.DynamoDB, tableName: string) => {
  const params = {
    TableName: tableName,
  } as DynamoDB.ScanInput;

  const scanResults: DynamoDB.AttributeMap[] = [];
  let items;
  do {
    items = await dynamodb.scan(params).promise();
    items.Items?.forEach((item) => scanResults.push(item));
    params.ExclusiveStartKey = items.LastEvaluatedKey;
  } while (typeof items.LastEvaluatedKey !== "undefined");

  return scanResults;
};

export const queryTable = async (
  dynamodb: AWS.DynamoDB,
  tableName: string,
  params: any,
) => {
  params = {
    TableName: tableName,
    ...params,
  } as DynamoDB.QueryInput;

  const queryResults: DynamoDB.AttributeMap[] = [];
  let items;
  do {
    items = await dynamodb.query(params).promise();
    items.Items?.forEach((item) => queryResults.push(item));
    params.ExclusiveStartKey = items.LastEvaluatedKey;
  } while (typeof items.LastEvaluatedKey !== "undefined");

  return queryResults;
};
