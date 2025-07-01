#!/usr/bin/env node
import "source-map-support/register";
import * as cdk from "aws-cdk-lib";
import { MpkbotStack } from "../lib/mpkbot-stack";

const app = new cdk.App();

new MpkbotStack(
  app,
  "MpkbotStack-Dev",
  {
    env: { account: "153157004393", region: "eu-north-1" },
    crossRegionReferences: true,
  },
  {
    route53zone: "mpkbot.fi",
    domain: "dev.mpkbot.fi",
    environmentInfo: "[DEV]",
  },
);

new MpkbotStack(
  app,
  "MpkbotStack-Prod",
  {
    env: { account: "153157004393", region: "eu-north-1" },
    crossRegionReferences: true,
  },
  {
    route53zone: "mpkbot.fi",
    domain: "mpkbot.fi",
    production: true,
    environmentInfo: "",
  },
);
