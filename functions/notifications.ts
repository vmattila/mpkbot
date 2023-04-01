
import moment from 'moment';
import * as AWS from 'aws-sdk';
const dynamodb = new AWS.DynamoDB();
const ses = new AWS.SES();

import * as uuid from 'uuid';
import { Handler } from 'aws-lambda'


import * as AmazonCognitoIdentity from 'amazon-cognito-identity-js';
const userPool = new AmazonCognitoIdentity.CognitoUserPool( {
	UserPoolId: process.env.COGNITO_USER_POOL_ID,
	ClientId: process.env.COGNITO_USER_POOL_CLIENT_ID,
});

import { CognitoIdentityProviderClient, AdminGetUserCommand, CreateUserPoolClientResponseFilterSensitiveLog } from '@aws-sdk/client-cognito-identity-provider';
import { populateCourseIndex, findCourses } from './courseindex/courseindex';
import { queryTable, scanTable } from './dynamodb/scan-query-table';
const cognitoClient = new CognitoIdentityProviderClient({});

const shouldNotify = async (courseId: number, userId: string)  => {
  const alreadyNotified = await dynamodb.getItem(
    {
      AttributesToGet: [
        "NotifiedAt"
      ],
        TableName: process.env.USER_NOTIFICATIONS_DYNAMODB_TABLE,
        Key: {
            UserId: {S: userId},
            CourseId: {N: courseId.toString()},
        }
    }).promise();
    if (alreadyNotified && alreadyNotified.Item) {
      return false;
    }

    return true;
}

const notifyUserOfCourses = async (userId, subscriptionId, keywords, notKeywords, coursesToSend)  => {

  const command = new AdminGetUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    Username: userId,
  });
  const response = await cognitoClient.send(command);
  const attrMap = {
    email: null,
  }
  for (const attr of response.UserAttributes) {
    attrMap[attr.Name] = attr.Value;
  }


  let titleKeywords = keywords;
  if (notKeywords) {
    titleKeywords = `${titleKeywords}, mutta ei ${notKeywords}`
  }

  try {
    const params = {
      Template: process.env.NOTIFICATION_SES_TEMPLATE_NAME,
      Destination: { 
        ToAddresses: [
          attrMap.email
        ]
      },
      Source: process.env.SES_SENDER,
      TemplateData: JSON.stringify({
        keyword: titleKeywords,
        courses: coursesToSend,
      }),
    };

    const sent = await ses.sendTemplatedEmail(params).promise();
    console.log(`Notification for user ${userId} sent, subscription ${subscriptionId}`);

    for (const course of coursesToSend) {
      await dynamodb.putItem({
        TableName: process.env.USER_NOTIFICATIONS_DYNAMODB_TABLE,
        Item: {
            UserId: {S: userId},
            CourseId: {N: course.id.toString()},
            NotifiedBy: {S: JSON.stringify({
              method: 'EMAIL'
            })},
            TriggeredSubscription: {S: subscriptionId},
            NotifiedAt: {N: moment().unix().toString()}
        }
      }).promise();
    }
  } catch (err) {
    console.error(`Notification email for user ${userId} failed: ${err.message}`);
  }
}

const asyncFilter = async (arr: any[], predicate: (course: any) => Promise<boolean>) => Promise.all(arr.map(predicate))
	.then((results) => arr.filter((_v, index) => results[index]));

export const addSubscription: Handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const body = JSON.parse(event.body);

  const subscriptionId = uuid.v4();

  await dynamodb.putItem(
    {
        TableName: process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE,
        Item: {
            UserId: {S: userId},
            SubscriptionId: {S: subscriptionId },
            Keywords: {S: body.keywords.trim()},
            NotKeywords: body.not_keywords?.trim() ? {S: body.not_keywords?.trim()} : {NULL: true},
        }
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

export const deleteSubscription: Handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;
  const subscriptionId = event.pathParameters?.subscriptionId;

  await dynamodb.deleteItem(
    {
        TableName: process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE,
        Key: {
            UserId: {S: userId},
            SubscriptionId: {S: subscriptionId },
        }
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
      keywords: doc.Keywords.S,
      not_keywords: doc.NotKeywords?.S,
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

export const runNotifications: Handler = async (event) => {
  await populateCourseIndex();
  
  const allRequests = await scanTable(dynamodb, process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE);
  for (const doc of allRequests) {
    const userId: string = doc.UserId.S || "";
    const subscriptionId: string = doc.SubscriptionId.S || "";
    const keywords: string = doc.Keywords.S || "";
    const notKeywords: string = doc.NotKeywords?.S || "";

    let matchingCourses = await findCourses(keywords, notKeywords);
    matchingCourses = await asyncFilter(matchingCourses, async (course) => {
      return await shouldNotify(course.id, userId);
    });

    if (matchingCourses.length > 0) {
      await notifyUserOfCourses(userId, subscriptionId, keywords, notKeywords, matchingCourses);
    }
  }
};
