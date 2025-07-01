declare global {
    namespace NodeJS {
      interface ProcessEnv {
        COURSES_DYNAMODB_TABLE: string;
        USER_NOTIFICATIONS_DYNAMODB_TABLE: string;
        USER_NOTIFICATION_SUBSCRIPTIONS_DYNAMODB_TABLE: string;
        STATUS_DYNAMODB_TABLE: string;
        
        SES_SENDER: string;
        NOTIFICATION_SES_TEMPLATE_NAME: string;
        
        SQS_CRAWL_QUEUE_URL: string;
        SQS_NOTIFICATION_QUEUE_URL: string;

        COGNITO_USER_POOL_ID: string;
        COGNITO_USER_POOL_CLIENT_ID: string;

        NODE_ENV: 'development' | 'production';
      }
    }
  }
  
  // If this file has no import/export statements (i.e. is a script)
  // convert it into a module by adding an empty export statement.
  export {}