import * as cdk from "aws-cdk-lib";
import * as iam from "aws-cdk-lib/aws-iam";
import * as s3 from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
export interface CiCdSetupProps extends cdk.StackProps {
  uiS3Bucket: s3.Bucket;
}

export class CiCdSetup extends Construct {
  constructor(scope: Construct, id: string, props: CiCdSetupProps) {
    super(scope, id);

    const user = new iam.User(this, "CiCdUser", {});

    const policy = new iam.Policy(this, "Policy", {
      statements: [
        new iam.PolicyStatement({
          actions: [
            "s3:DeleteObject",
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:PutObject",
            "s3:PutObjectAcl",
          ],
          resources: [
            props.uiS3Bucket.bucketArn,
            `${props.uiS3Bucket.bucketArn}/*`,
          ],
        }),
      ],
    });

    policy.attachToUser(user);

    const accessKey = new iam.AccessKey(this, "AccessKey", { user });

    new cdk.CfnOutput(this, "accessKeyId", { value: accessKey.accessKeyId });
    new cdk.CfnOutput(this, "secretAccessKey", {
      value: accessKey.secretAccessKey.unsafeUnwrap(),
    });
  }
}
