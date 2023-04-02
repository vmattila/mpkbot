
import moment from 'moment';
import * as AWS from 'aws-sdk';
const dynamodb = new AWS.DynamoDB();
const ses = new AWS.SES();
const sqs = new AWS.SQS();

import { Handler } from 'aws-lambda'

import { CognitoIdentityProviderClient, AdminGetUserCommand } from '@aws-sdk/client-cognito-identity-provider';
import { populateCourseIndex, findCourses, getCourseJsonById } from './courseindex/courseindex';
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

    console.debug(`Course ${courseId} User ${userId} not yet notified.`);
    return true;
}

const notifyUserOfCourses = async (userId: string, subscriptionId: string, searchTokens: string[], coursesToSend: any[])  => {

  const command = new AdminGetUserCommand({
    UserPoolId: process.env.COGNITO_USER_POOL_ID,
    Username: userId,
  });
  const response = await cognitoClient.send(command);
  const attrMap = {
    email: null,
  } as any;
  for (const attr of response.UserAttributes || []) {
    attrMap[attr.Name] = attr.Value;
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
        keyword: searchTokens.join(" "),
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
    console.error(`Notification email for user ${userId} subscription ${subscriptionId} failed: ${err.message}`);
  }
}

const asyncFilter = async (arr: any[], predicate: (course: any) => Promise<boolean>) => Promise.all(arr.map(predicate))
	.then((results) => arr.filter((_v, index) => results[index]));

export const runNotifications: Handler = async (event) => {
  await populateCourseIndex();
  
  const allRequests = await scanTable(dynamodb, process.env.USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE);
  
  console.log(`Found ${allRequests.length} subscriptions.`);

  for (const doc of allRequests) {
    const userId: string = doc.UserId.S || "";
    const subscriptionId: string = doc.SubscriptionId.S || "";
    const tokens: string[] = doc.Tokens.SS || [];

    await doHandleSubscriptionNotification(userId, subscriptionId, tokens);
  }
};

const doHandleSubscriptionNotification = async (userId: string, subscriptionId: string, tokens: string[]) => {
  await populateCourseIndex();

  let matchingCourses = await findCourses(tokens);
  matchingCourses = await asyncFilter(matchingCourses, async (course) => {
    return await shouldNotify(course.id, userId);
  });

  if (matchingCourses.length > 0) {
    await notifyUserOfCourses(userId, subscriptionId, tokens, matchingCourses);
  }
};

export const handleSqsHandleNotificationEvent: Handler = async (event) => {
  for (const record of event.Records) {
    console.log(`Message received from the queue`, record);
    const message = JSON.parse(record.body);
    console.log(`Handling message ${record.messageId} from the queue. User ${message.userId} Subscription ${message.subscriptionId}`);
    await doHandleSubscriptionNotification(message.userId, message.subscriptionId, message.tokens);
    await sqs.deleteMessage({
      ReceiptHandle: record.receiptHandle,
      QueueUrl: process.env.SQS_NOTIFICATION_QUEUE_URL,
    }).promise();
  }
}

export const getMyNotifiedCourses: Handler = async (event) => {
  const userId = event.requestContext.authorizer.claims.sub;

  const notifications = await queryTable(dynamodb, process.env.USER_NOTIFICATIONS_DYNAMODB_TABLE,
    {
      ExpressionAttributeValues: {
        ':userId': {S: userId},
        ':courseId': {N: "0"},
      },
      KeyConditionExpression: 'UserId = :userId AND CourseId > :courseId',
    });
  const jsonReply = [];
  for (const doc of notifications) {
    jsonReply.push({
      course: getCourseJsonById(parseInt(doc.CourseId.N || "0", 10)),
      notified_at: doc.NotifiedAt.N,
    });
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      notifications: jsonReply
    }),
    headers: {
      "Access-Control-Allow-Headers" : "*",
      "Access-Control-Allow-Origin": "*"
    },
  };
};