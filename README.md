# MPK Bot

Tämä repository pitää sisällään MPK Bot -palvelun lähdekoodit. Löydät palvelun osoitteesta
https://mpkbot.fi/

Palvelun käyttöliittymän lähdekoodit löytyvät erillisestä repositorystä: https://github.com/vmattila/mpkbot-ui

## Ympäristö

Palvelu käyttää hyödyksi Amazon Web Services -ympäristöä. Ympäristö on kuvattu [AWS Cloud Development Kit (CDK) -työkalulla](https://aws.amazon.com/cdk/) tässä repossa. Tuotantoympäristö sijaitsee `eu-north-1` -alueella Tukholmassa.

## Käytetyt palvelut

Palveluiden määritykset löytyvät [lib/] -hakemistosta. CDK-pohjastack löytyy [lib/mpkbot-stack.ts] -tiedostosta.

### AWS DynamoDB

Palvelu tallentaa tiedot AWS DynamoDB -tietokantaan. 

 * `Courses`-taulussa on kurssien tiedot MPK:n koulutuskalenterista. Kurssi poistetaan automaattisesti 24h kurssin päättymisen jälkeen DynamoDB:n oman TTL-toiminnallisuuden kautta (`TTLTime` -kenttä ). Primääriavain on `CourseId`.
 * `NotificationSubscriptions`-taulussa on käyttäjien määrittämät hakuvahdit. Primääriavain on `SubscriptionID`, tallennusvaiheessa luotava UUID.
 * `Notifications`-taulussa on käyttäjille ilmoitetut kurssit, eli "hakuvahtiosumat". Primääriavain on `UserId` + `CourseId`.

### AWS Cognito

MPK Botin käyttäjätietoja ylläpidetään Amazon Cognito -palvelussa. Käyttäjistä tallennetaan sähköpostiosoite, joka validoidaan rekisteröitymispyynnön yhteydessä. Cognito antaa käyttäjälle UUID:n, jota käytetään referenssinä järjestelmän omissa tietokannoissa (ks. DynamoDB).

### AWS Simple Email Service (SES)

Sähköpostiviestit lähetetään AWS SES -palvelun kautta. Viestipohjia on yksi: tieto uusista löytyneistä kursseista. Viestipohja on määritelty [./lib/email-configuration.ts] -tiedostossa.

### AWS API Gateway

Palvelun REST API julkaistaan API Gatewayn kautta. Endpointeihin on liitetty Cognito Authorizer, jonka kautta API-kutsut autentikoidaan.

### AWS Lambda

Palvelun toimintalogiikka on AWS Lambda -funktioissa, jotka löytyvät [./functions/]-hakemistosta.