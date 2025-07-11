import * as cdk from "aws-cdk-lib";
import { Construct, IDependable } from "constructs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as apigw from "aws-cdk-lib/aws-apigateway";
import * as cognito from "aws-cdk-lib/aws-cognito";
import * as route53 from "aws-cdk-lib/aws-route53";
import { CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as iam from "aws-cdk-lib/aws-iam";
import * as cloudfront from "aws-cdk-lib/aws-cloudfront";
import { S3Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { SqsEventSource } from "aws-cdk-lib/aws-lambda-event-sources";
import path = require("node:path");
import * as acm from "aws-cdk-lib/aws-certificatemanager";
import { CiCdSetup } from "./cicd-setup";
import { Schedule } from "aws-cdk-lib/aws-events";
import {
  AppLambdaFunction,
  AppLambdaFunctionProps,
} from "./app-lambda-function-base";
import { EmailConfiguration } from './email-configuration';

export interface MpkStackConfiguration {
  route53zone: string;
  domain: string;
  production?: boolean;
  environmentInfo?: string;
}

export interface RestApiLambdaFunctionProps extends AppLambdaFunctionProps {
  resource: apigw.IResource;
  method: string;
  authorizer?: any;
}

export class RestApiLambdaFunction extends Construct {
  constructor(scope: Construct, id: string, props: RestApiLambdaFunctionProps) {
    super(scope, id);

    const nodejsFunction = new AppLambdaFunction(this, "Fn", {
      ...props,
    });

    const methodOptions = {} as any;

    if (props.authorizer) {
      methodOptions.authorizer = props.authorizer;
      methodOptions.authorizationType = apigw.AuthorizationType.COGNITO;
    }

    props.resource.addMethod(
      props.method,
      new apigw.LambdaIntegration(nodejsFunction.function, {
        allowTestInvoke: false,
      }),
      methodOptions,
    );
  }
}

export class MpkbotStack extends cdk.Stack {
  constructor(
    scope: Construct,
    id: string,
    props: cdk.StackProps,
    stackConfig: MpkStackConfiguration,
  ) {
    super(scope, id, props);

    const zone = route53.HostedZone.fromLookup(this, "Zone", {
      domainName: stackConfig.route53zone,
    });

    // Crawl Queue
    const crawlQueue = new sqs.Queue(this, "CrawlQueue", {
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    // Crawl Queue
    const notificationsQueue = new sqs.Queue(this, "NotificationsQueue", {
      visibilityTimeout: cdk.Duration.seconds(300),
    });

    // DynamoDB Tables
    const statusTable = new dynamodb.Table(this, "Status", {
      partitionKey: { name: "StatusKey", type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: false,
      tableClass: dynamodb.TableClass.STANDARD_INFREQUENT_ACCESS,
    });

    const coursesTable = new dynamodb.Table(this, "Courses", {
      partitionKey: { name: "CourseId", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: false,
      tableClass: dynamodb.TableClass.STANDARD_INFREQUENT_ACCESS,
      timeToLiveAttribute: "TTLTime",
    });

    const notificationSubsTable = new dynamodb.Table(
      this,
      "NotificationSubscriptions",
      {
        partitionKey: { name: "UserId", type: dynamodb.AttributeType.STRING },
        sortKey: {
          name: "SubscriptionId",
          type: dynamodb.AttributeType.STRING,
        },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        pointInTimeRecovery: false,
        tableClass: dynamodb.TableClass.STANDARD_INFREQUENT_ACCESS,
      },
    );

    const notificationTable = new dynamodb.Table(this, "Notifications", {
      partitionKey: { name: "UserId", type: dynamodb.AttributeType.STRING },
      sortKey: { name: "CourseId", type: dynamodb.AttributeType.NUMBER },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecovery: false,
      tableClass: dynamodb.TableClass.STANDARD_INFREQUENT_ACCESS,
    });
    notificationTable.addLocalSecondaryIndex({
      indexName: "CourseIdIndex",
      sortKey: { name: "CourseId", type: dynamodb.AttributeType.NUMBER },
      projectionType: dynamodb.ProjectionType.ALL,
    });
    notificationTable.addLocalSecondaryIndex({
      indexName: "TriggeredSubscriptionIndex",
      sortKey: {
        name: "TriggeredSubscription",
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    const emailAddress = `kirjaamo@${stackConfig.route53zone}`;

    const userPool = new cognito.UserPool(this, "Users", {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      signInCaseSensitive: false, // case insensitive is preferred in most situations,
      selfSignUpEnabled: true,
      signInAliases: {
        username: false,
        email: true,
        phone: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: {
        sms: false,
        otp: true,
      },
      userVerification: {
        emailSubject:
          `Vahvista sähköpostiosoitteesi käyttääksesi MPKBottia ${stackConfig.environmentInfo}`.trim(),
        emailBody:
          "Kiitos, että rekisteröidyit käyttämään MPKBotia. Vahvistuskoodisi on {####}",
        emailStyle: cognito.VerificationEmailStyle.CODE,
        //smsMessage: 'Kiitos, että rekisteröidyit käyttämään MPKBotia. Vahvistuskoodisi on {####}',
      },
      userInvitation: {
        emailSubject:
          `Tervetuloa käyttämään MPKBottia ${stackConfig.environmentInfo}`.trim(),
        emailBody:
          "Hei {username}, sinut on kutsuttu käyttämään MPKBottia! Väliaikainen salasanasi kirjautumiseen on {####}. Vaihda salasana ensimmäisellä kirjautumiskerralla.",
        //smsMessage: 'Hei {username}, väliaikainen MPKBot-salasanasi on {####}',
      },
      email: cognito.UserPoolEmail.withSES({
        fromEmail: `no-reply@${stackConfig.route53zone}`,
        fromName: `MPKBot ${stackConfig.environmentInfo}`.trim(),
        replyTo: emailAddress,
        sesVerifiedDomain: stackConfig.route53zone,
      }),
    });

    new cdk.CfnOutput(this, "UserPoolId", { value: userPool.userPoolId });

    const cognitoAuthorizer = new apigw.CognitoUserPoolsAuthorizer(
      this,
      "CognitoAuthorizer",
      {
        cognitoUserPools: [userPool],
      },
    );

    const userPoolApiClient = userPool.addClient("ApiClient", {
      generateSecret: true,
    });

  const emailConfiguration = new EmailConfiguration(this, 'MpkBotEmail', {
    environmentInfo: stackConfig.environmentInfo,
  })

    const commonLambdaEnvs = {
      COURSES_DYNAMODB_TABLE: coursesTable.tableName,
      USER_NOTIFICATIONS_DYNAMODB_TABLE: notificationTable.tableName,
      USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE:
        notificationSubsTable.tableName,
      SQS_CRAWL_QUEUE_URL: crawlQueue.queueUrl,
      SQS_NOTIFICATION_QUEUE_URL: notificationsQueue.queueUrl,
      COGNITO_USER_POOL_ID: userPool.userPoolId,
      COGNITO_USER_POOL_CLIENT_ID: userPoolApiClient.userPoolClientId,
      COGNITO_USER_POOL_CLIENT_SECRET:
        userPoolApiClient.userPoolClientSecret.unsafeUnwrap(),
      NOTIFICATION_SES_TEMPLATE_NAME: emailConfiguration.notificationTemplate.templateName,
      SES_SENDER: emailAddress,
      STATUS_DYNAMODB_TABLE: statusTable.tableName,
    };
    const lambdaDependencies: IDependable[] = [
      coursesTable,
      notificationTable,
      notificationSubsTable,
      statusTable,
      crawlQueue,
      notificationsQueue,
      userPool,
      userPoolApiClient,
      emailConfiguration.notificationTemplate,
    ];

    // Lambda Functions
    const lambdas = [];
    lambdas.push(
      new AppLambdaFunction(this, "Crawl", {
        entry: path.join(__dirname, `/../functions/crawler.ts`),
        handler: "crawl",
        environment: commonLambdaEnvs,
        timeout: cdk.Duration.minutes(10),
        schedule: Schedule.rate(cdk.Duration.hours(3)),
        rwTables: [coursesTable, statusTable],
        publishesToQueues: [crawlQueue],
        reservedConcurrentExecutions: 1,
      }),
    );

    const handleCrawlQueueFunction = new AppLambdaFunction(
      this,
      "HandleCrawlQueue",
      {
        entry: path.join(__dirname, `/../functions/crawler.ts`),
        handler: "handleSqsCrawlEvent",
        environment: commonLambdaEnvs,
        timeout: cdk.Duration.minutes(1),
        rwTables: [coursesTable, statusTable],
        reservedConcurrentExecutions: 2,
      },
    );
    handleCrawlQueueFunction.function.addEventSource(
      new SqsEventSource(crawlQueue),
    );
    lambdas.push(handleCrawlQueueFunction);

    lambdas.push(
      new AppLambdaFunction(this, "RunNotifications", {
        entry: path.join(__dirname, `/../functions/notification-runner.ts`),
        handler: "runNotifications",
        environment: commonLambdaEnvs,
        timeout: cdk.Duration.minutes(10),
        schedule: Schedule.rate(cdk.Duration.hours(1)),
        readTables: [coursesTable, notificationSubsTable, statusTable],
        rwTables: [notificationTable],
        allowSesSendTemplates: [emailConfiguration.notificationTemplate],
        allowCognitoAdminToPool: userPool,
      }),
    );

    const handleNotificationsQueueFunction = new AppLambdaFunction(
      this,
      "HandleNotificationQueue",
      {
        entry: path.join(__dirname, `/../functions/notification-runner.ts`),
        handler: "handleSqsHandleNotificationEvent",
        environment: commonLambdaEnvs,
        timeout: cdk.Duration.minutes(1),
        readTables: [coursesTable, notificationSubsTable, statusTable],
        rwTables: [notificationTable],
        allowSesSendTemplates: [emailConfiguration.notificationTemplate],
        allowCognitoAdminToPool: userPool,
        reservedConcurrentExecutions: 2,
      },
    );
    handleNotificationsQueueFunction.function.addEventSource(
      new SqsEventSource(notificationsQueue),
    );
    lambdas.push(handleNotificationsQueueFunction);

    // API
    const api = new apigw.RestApi(this, "Api", {
      description: "MPKBot API Gateway",
      defaultCorsPreflightOptions: {
        allowHeaders: [
          "Content-Type",
          "X-Amz-Date",
          "Authorization",
          "X-Api-Key",
        ],
        allowMethods: ["OPTIONS", "GET", "POST", "PUT", "PATCH", "DELETE"],
        allowCredentials: true,
        allowOrigins: apigw.Cors.ALL_ORIGINS,
      },
    });
    lambdas.push(
      new RestApiLambdaFunction(this, "ShowInfo", {
        resource: api.root,
        method: "GET",
        entry: path.join(__dirname, `/../functions/info.ts`),
        handler: "showPublicInfo",
        environment: commonLambdaEnvs,
        readTables: [statusTable],
      }),
    );

    const coursesRoot = api.root.addResource("courses");
    lambdas.push(
      new RestApiLambdaFunction(this, "GetCourses", {
        resource: coursesRoot,
        method: "GET",
        entry: path.join(__dirname, `/../functions/courses.ts`),
        handler: "getCourses",
        timeout: cdk.Duration.seconds(29),
        environment: commonLambdaEnvs,
        readTables: [coursesTable, statusTable],
        authorizer: cognitoAuthorizer,
      }),
    );

    const notificationsRoot = api.root.addResource("notifications");
    lambdas.push(
      new RestApiLambdaFunction(this, "GetMyNotifications", {
        resource: notificationsRoot,
        method: "GET",
        entry: path.join(__dirname, `/../functions/notification-runner.ts`),
        handler: "getMyNotifiedCourses",
        environment: commonLambdaEnvs,
        readTables: [notificationTable, coursesTable, statusTable],
        authorizer: cognitoAuthorizer,
      }),
    );

    const subsriptionsRoot = api.root.addResource("subscriptions");
    lambdas.push(
      new RestApiLambdaFunction(this, "GetSubscriptions", {
        resource: subsriptionsRoot,
        method: "GET",
        entry: path.join(__dirname, `/../functions/subscriptions.ts`),
        handler: "getSubscriptions",
        environment: commonLambdaEnvs,
        rwTables: [notificationSubsTable],
        authorizer: cognitoAuthorizer,
      }),
    );
    lambdas.push(
      new RestApiLambdaFunction(this, "AddSubscription", {
        resource: subsriptionsRoot,
        method: "POST",
        entry: path.join(__dirname, `/../functions/subscriptions.ts`),
        handler: "addSubscription",
        environment: commonLambdaEnvs,
        rwTables: [notificationSubsTable],
        authorizer: cognitoAuthorizer,
        publishesToQueues: [notificationsQueue],
      }),
    );

    const subsriptionRoot = subsriptionsRoot.addResource("{subscriptionId}");
    lambdas.push(
      new RestApiLambdaFunction(this, "DeleteSubscription", {
        resource: subsriptionRoot,
        method: "DELETE",
        entry: path.join(__dirname, `/../functions/subscriptions.ts`),
        handler: "deleteSubscription",
        environment: commonLambdaEnvs,
        rwTables: [notificationSubsTable, notificationTable],
        authorizer: cognitoAuthorizer,
      }),
    );

    const meRoot = api.root.addResource("me");
    lambdas.push(
      new RestApiLambdaFunction(this, "DeleteUser", {
        resource: meRoot,
        method: "DELETE",
        entry: path.join(__dirname, `/../functions/subscriptions.ts`),
        handler: "deleteMyself",
        environment: commonLambdaEnvs,
        rwTables: [notificationSubsTable, notificationTable],
        authorizer: cognitoAuthorizer,
        allowCognitoAdminToPool: userPool,
        timeout: cdk.Duration.seconds(29),
      }),
    );

    for (const lambdaFn of lambdas) {
      for (const lambdaDependency of lambdaDependencies) {
        lambdaFn.node.addDependency(lambdaDependency);
      }
    }

    const authDomainName = `auth.${stackConfig.domain}`;

    new cdk.CfnOutput(this, "CognitoDomain", { value: authDomainName });

    const uiClientDomains = ["https://" + stackConfig.domain];
    if (!stackConfig.production) {
      uiClientDomains.push("http://localhost:3000");
    }

    const client = userPool.addClient("UiClient", {
      generateSecret: false,
      oAuth: {
        scopes: [cognito.OAuthScope.OPENID],
        flows: {
          implicitCodeGrant: true,
        },
        callbackUrls: uiClientDomains,
        logoutUrls: uiClientDomains,
      },
    });

    new cdk.CfnOutput(this, "UiClientId", { value: client.userPoolClientId });

    const uiBucket = new s3.Bucket(this, "WebsiteBucket", {
      publicReadAccess: false,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      accessControl: s3.BucketAccessControl.PRIVATE,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    new cdk.CfnOutput(this, "UiBucket", { value: uiBucket.bucketName });

    const cloudfrontOAI = new cloudfront.OriginAccessIdentity(
      this,
      "CloudFrontOriginAccessIdentity",
    );

    uiBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        actions: ["s3:GetObject"],
        resources: [uiBucket.arnForObjects("*")],
        principals: [
          new iam.CanonicalUserPrincipal(
            cloudfrontOAI.cloudFrontOriginAccessIdentityS3CanonicalUserId,
          ),
        ],
      }),
    );

    const uiCertificate = new acm.DnsValidatedCertificate(
      this,
      "UiCertificate",
      {
        domainName: stackConfig.domain,
        hostedZone: zone,
        region: "us-east-1",
      },
    );

    const responseHeaderPolicy = new cloudfront.ResponseHeadersPolicy(
      this,
      "SecurityHeadersResponseHeaderPolicy",
      {
        comment: "Security headers response header policy",
        securityHeadersBehavior: {
          contentSecurityPolicy: {
            override: true,
            contentSecurityPolicy: `default-src 'self' ${api.url} https://cognito-idp.eu-north-1.amazonaws.com/`,
          },
          strictTransportSecurity: {
            override: true,
            accessControlMaxAge: cdk.Duration.days(2 * 365),
            includeSubdomains: true,
            preload: true,
          },
          contentTypeOptions: {
            override: true,
          },
          referrerPolicy: {
            override: true,
            referrerPolicy:
              cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN,
          },
          xssProtection: {
            override: true,
            protection: true,
            modeBlock: true,
          },
          frameOptions: {
            override: true,
            frameOption: cloudfront.HeadersFrameOption.DENY,
          },
        },
      },
    );

    const uiCachePolicy = new cloudfront.CachePolicy(this, "UiCachePolicy", {
      comment: "Policy for UI",
      defaultTtl: cdk.Duration.minutes(0),
      minTtl: cdk.Duration.minutes(0),
      maxTtl: cdk.Duration.minutes(1),
      cookieBehavior: cloudfront.CacheCookieBehavior.none(),
      headerBehavior: cloudfront.CacheHeaderBehavior.none(),
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.none(),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    const uiDistribution = new cloudfront.Distribution(this, "UiDistribution", {
      certificate: uiCertificate,
      domainNames: [stackConfig.domain],
      defaultRootObject: "index.html",
      defaultBehavior: {
        cachePolicy: uiCachePolicy,
        origin: new S3Origin(uiBucket, {
          originAccessIdentity: cloudfrontOAI,
        }),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        responseHeadersPolicy: responseHeaderPolicy,
      },
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
    });

    const rootRouteRecord = new route53.ARecord(this, "UiCloudFrontARecord", {
      zone: zone,
      recordName: stackConfig.domain,
      target: route53.RecordTarget.fromAlias(
        new CloudFrontTarget(uiDistribution),
      ),
    });

    new route53.AaaaRecord(this, "UiCloudFrontAAAARecord", {
      zone: zone,
      recordName: stackConfig.domain,
      target: route53.RecordTarget.fromAlias(
        new CloudFrontTarget(uiDistribution),
      ),
    });

    new CiCdSetup(this, "CiCdSetup", {
      uiS3Bucket: uiBucket,
    });
  }
}
