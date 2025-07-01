import { Construct } from "constructs";
import { SesTemplate } from "./ses-template";

export interface EmailConfigurationProps {
  environmentInfo?: string;
}

export class EmailConfiguration extends Construct {
  public notificationTemplate: SesTemplate;

  constructor(scope: Construct, id: string, props: EmailConfigurationProps) {
    super(scope, id);

    this.notificationTemplate = new SesTemplate(this, "NotificationTemplate", {
      subjectPart:
        `Uusia MPK-kursseja hakusanalla {{keyword}} ${props.environmentInfo}`.trim(),
      htmlPart: `<p>Tämä on automaattinen viesti mpkbotilta.</p>

      <p>Seuraavia uusia kursseja on löytynyt MPK:n koulutuskalenterista.</p>

      {{#each courses}}
        <p>
          <strong>{{name}}</strong><br />
          {{timeinfo}} @ {{location}}<br />
          Lisätietoja: <a href="{{link}}">{{link}}</a>
        </p>
      {{/each}}
      <hr>`,

      textPart: `Tämä on automaattinen viesti mpkbotilta.

      Seuraavia uusia kursseja on löytynyt MPK:n koulutuskalenterista.

      {{#each courses}}
        {{name}}
        {{timeinfo}} @ {{location}}
        Lisätietoja: {{link}}
        -
      {{/each}}`,
    });
  }
}
