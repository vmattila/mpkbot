
import * as AWS from 'aws-sdk';
const dynamodb = new AWS.DynamoDB();
const sqs = new AWS.SQS();

import * as uuid from 'uuid';
import { Handler } from 'aws-lambda'

import { queryTable } from './dynamodb/scan-query-table';

import { CognitoIdentityProviderClient, AdminDeleteUserCommand } from '@aws-sdk/client-cognito-identity-provider';
const cognitoClient = new CognitoIdentityProviderClient({});

export const addSubscription: Handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const body = JSON.parse(event.body);

  const tokens = body.tokens || [];
  const filteredTokens = tokens.map((e: string) => e.trim()).filter((x: string | any[]) => {
    return x.length > 1
  }).filter((value: any, index: any, array: string | any[]) => array.indexOf(value) === index);
  if (filteredTokens.length < 1) {
    return {
      statusCode: 400,
      body: JSON.stringify({
        error: 'token'
      }),
      headers: {
        "Access-Control-Allow-Headers" : "*",
        "Access-Control-Allow-Origin": "*"
      },
    };
  }

  const subscriptionId = uuid.v4();

  await dynamodb.putItem(
    {
        TableName: process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE,
        Item: {
            UserId: {S: userId},
            SubscriptionId: {S: subscriptionId },
            Tokens: {SS: filteredTokens},
        }
    }).promise();

  await sqs.sendMessage({
    MessageBody: JSON.stringify({
      userId: userId,
      subscriptionId: subscriptionId,
      tokens: filteredTokens,
    }),
    QueueUrl: process.env.SQS_NOTIFICATION_QUEUE_URL,
  }).promise();

  return {
    statusCode: 200,
    body: JSON.stringify({
      subscription: {
        id: subscriptionId
      }
    }),
    headers: {
      "Access-Control-Allow-Headers" : "*",
      "Access-Control-Allow-Origin": "*"
    },
  };
};

export const doDeleteSubscription = async (userId: string, subscriptionId: string) => {

  console.log(`Deleting subscription ${subscriptionId} for user ${userId}`);

  // Haetaan mahdolliset jo lähetetyt notifikaatiot tällä subscriptionilla ja poistetaan ne
  const matchingNotifications = await queryTable(dynamodb, process.env.USER_NOTIFICATIONS_DYNAMODB_TABLE, 
    {
        IndexName: "TriggeredSubscriptionIndex",
        KeyConditionExpression: "#UserId = :userId and #TriggeredSubscription = :subscriptionId",
        ExpressionAttributeNames: {
            "#TriggeredSubscription": "TriggeredSubscription",
            "#UserId": "UserId",
        },
        ExpressionAttributeValues: {
            ":subscriptionId": {S: subscriptionId},
            ":userId": {S: userId},
        },
    });
  for (const notification of matchingNotifications) {
    console.log(`Removing course notification for subscription ${subscriptionId} / course ${notification.CourseId.N}`)
    await dynamodb.deleteItem({
      TableName: process.env.USER_NOTIFICATIONS_DYNAMODB_TABLE,
      Key: {
        UserId: {S: userId},
        CourseId: notification.CourseId,
      }
    }).promise();
  }

  // Poistetaan varsinainen subscription
  await dynamodb.deleteItem(
    {
        TableName: process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE,
        Key: {
            UserId: {S: userId},
            SubscriptionId: {S: subscriptionId },
        }
    }).promise();
  
  console.log(`Subscription ${subscriptionId} for user ${userId} deleted successfully.`);
};

export const deleteSubscription: Handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const subscriptionId = event.pathParameters?.subscriptionId;

  await doDeleteSubscription(userId, subscriptionId);

  return {
    statusCode: 200,
    body: JSON.stringify({
      subscription: {
        id: subscriptionId
      }
    }),
    headers: {
      "Access-Control-Allow-Headers" : "*",
      "Access-Control-Allow-Origin": "*"
    },
  };
};

export const getSubscriptions: Handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;

  const subscriptions = await queryTable(dynamodb, process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE,
    {
      ExpressionAttributeValues: {
        ':userId': {S: userId},
      },
      KeyConditionExpression: 'UserId = :userId',
    });
  const jsonReply = [];
  for (const doc of subscriptions) {
    jsonReply.push({
      id: doc.SubscriptionId.S,
      tokens: doc.Tokens.SS || [],
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      subscriptions: jsonReply
    }),
    headers: {
      "Access-Control-Allow-Headers" : "*",
      "Access-Control-Allow-Origin": "*"
    },
  };
};

export const deleteMyself: Handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;

  const subscriptions = await queryTable(dynamodb, process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE,
    {
      ExpressionAttributeValues: {
        ':userId': {S: userId},
      },
      KeyConditionExpression: 'UserId = :userId',
    });
  for (const doc of subscriptions) {
    await doDeleteSubscription(userId, doc.SubscriptionId?.S || "")
  }

  const command = new AdminDeleteUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    Username: userId,
  });
  await cognitoClient.send(command);

  return {
    statusCode: 200,
    body: JSON.stringify({
      success: true
    }),
    headers: {
      "Access-Control-Allow-Headers" : "*",
      "Access-Control-Allow-Origin": "*"
    },
  };
};