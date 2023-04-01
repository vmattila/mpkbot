import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ses from 'aws-cdk-lib/aws-ses';

export interface SesTemplateProps extends cdk.StackProps {
  subjectPart: string;
  htmlPart?: string;
  textPart?: string;
  }
export class SesTemplate extends Construct {

    public templateName: string;
    public id: string;

    constructor(scope: Construct, id: string, props: SesTemplateProps) {
      super(scope, id);
  
      const cfnTemplate = new ses.CfnTemplate(this, 'Template', {
        template: {
          subjectPart: props.subjectPart,
          htmlPart: props.htmlPart,
          textPart: props.textPart,
      }
    }
      );

      this.id = cfnTemplate.getAtt('Id').toString();
      this.templateName = cfnTemplate.getAtt('Id').toString();
    }
  }