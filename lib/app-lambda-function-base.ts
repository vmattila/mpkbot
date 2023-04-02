import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import {NodejsFunction} from "aws-cdk-lib/aws-lambda-nodejs"
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import {Rule, Schedule} from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';

import path = require('node:path');
export interface AppLambdaFunctionProps extends cdk.StackProps {
    entry: string;
    handler: string;
    environment?: any;
    rwTables?: dynamodb.Table[]
    readTables?: dynamodb.Table[]
    publishesToQueues?: sqs.Queue[]
    allowSesSendTemplates?: SesTemplate[]
    timeout?: cdk.Duration
    schedule?: Schedule
    reservedConcurrentExecutions?: number
    allowCognitoAdminToPool?: cognito.UserPool
  }
import { RetentionDays } from 'aws-cdk-lib/aws-logs';
import { SesTemplate } from './ses-template';

export class AppLambdaFunction extends Construct {

    public function: NodejsFunction;

    constructor(scope: Construct, id: string, props: AppLambdaFunctionProps) {
      super(scope, id);
  
      const nodejsFunction = new NodejsFunction(this, `Fn`, {
        runtime: lambda.Runtime.NODEJS_16_X,
        entry: props.entry,
        handler: props.handler,
        environment: props.environment,
        logRetention: RetentionDays.ONE_WEEK,
        timeout: props.timeout,
        reservedConcurrentExecutions: props.reservedConcurrentExecutions,
      });
  
      for (const rwTable of props.rwTables || []) {
        rwTable.grantReadWriteData(nodejsFunction);
      }
      for (const readTable of props.readTables || []) {
        readTable.grantReadData(nodejsFunction);
      }

      for (const queue of props.publishesToQueues || []) {
        queue.grantSendMessages(nodejsFunction);
      }

      if (props.schedule) {
        new Rule(this, 'Schedule', {
          schedule: props.schedule,
          targets: [new targets.LambdaFunction(nodejsFunction)],
        });
      }
      if (props.allowSesSendTemplates) {
        for (const template of props.allowSesSendTemplates) {
          const allowSesSendTemplatePolicy = new iam.PolicyStatement({
              actions: ['ses:SendTemplatedEmail'],
              resources: [
                `arn:aws:ses:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:template/${template.templateName}`,
                `arn:aws:ses:${cdk.Stack.of(this).region}:${cdk.Stack.of(this).account}:identity/*`,
              ],
            });
          nodejsFunction.role?.attachInlinePolicy(
            new iam.Policy(this, 'AllowTemplateSend', {
              statements: [allowSesSendTemplatePolicy],
            }),
          );
        }
      }
      if (props.allowCognitoAdminToPool) {
        const allowCognitoAdminPolicy = new iam.PolicyStatement({
          actions: ['cognito-idp:AdminGetUser','cognito-idp:AdminDeleteUser'],
          resources: [props.allowCognitoAdminToPool.userPoolArn],
        });
        nodejsFunction.role?.attachInlinePolicy(
          new iam.Policy(this, 'AllowCognitoAdmin', {
            statements: [allowCognitoAdminPolicy],
          }),
        );
      }
      this.function = nodejsFunction;
    }
  }