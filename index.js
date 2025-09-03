const yf = require('yahoo-finance2').default;
const moment = require('moment-timezone');
const AWS = require('aws-sdk');
const { Parser } = require('json2csv');

AWS.config.update({
  region: 'eu-north-1'
});
const ses = new AWS.SES();
const s3 = new AWS.S3({
    region: 'eu-north-1' // Replace with your desired region
});


const faangStocks = ['AAPL', 'AMZN', 'MSFT', 'GOOGL'];
const maxPercentDip = 10.0;

// Convert date strings to Unix timestamps in seconds
const todayTimestamp = moment().tz('Asia/Kolkata').startOf('day').unix();
const fiveDaysAgoTimestamp = moment().tz('Asia/Kolkata').subtract(5, 'days').startOf('day').unix();
const tomorrowTimestamp = moment().tz('Asia/Kolkata').add(1, 'days').startOf('day').unix();

const emailSender = 'shivanis.0309@gmail.com';
const emailReceivers = ['shivan.suresh@gmail.com'];

exports.handler = async () => {
  console.log('Handler started. Retrieving stock dip list...');
  const stockDipList = await retrieveStockDipList();
  console.log('Stock dip list retrieved:', stockDipList);

  if (stockDipList.length > 0) {
    await sendEmail(stockDipList);
  } else {
    console.log('No stocks found with a dip greater than the specified threshold.');
  }
};

async function retrieveStockDipList() {
    const stockInfoList = [];
    console.log('Starting to retrieve stock dip information for FAANG stocks.');

    for (const stock of faangStocks) {
        console.log(`Fetching data for ${stock}...`);

        // Define the date strings
        const period1 = '2024-09-29'; // 5 days ago
        const period2 = '2024-10-04'; // today

        const priceHistory = await yf.chart(stock, {
            period1: period1,  // Using date strings in 'YYYY-MM-DD' format
            period2: period2,
            interval: '1d',    // Daily data
        });

        // Log the entire priceHistory response for inspection
        console.log(`Price history for ${stock}:`, priceHistory);

        // Ensure priceHistory contains valid data
        if (!priceHistory || !priceHistory.quotes || priceHistory.quotes.length === 0) {
            console.warn(`No price history found for ${stock}.`);
            continue; // Skip to the next stock
        }

        // Prepare the data for CSV
        const csvData = priceHistory.quotes.map(quote => ({
            date: quote.date,
            high: quote.high,
            volume: quote.volume,
            open: quote.open,
            low: quote.low,
            close: quote.close,
            adjclose: quote.adjclose
        }));

        // Check if csvData has data to convert
        if (csvData.length === 0) {
            console.warn(`No data available for CSV conversion for ${stock}.`);
            continue; // Skip to the next stock
        }

        const json2csvParser = new Parser();
        const csv = json2csvParser.parse(csvData); // Parse the structured data for CSV

        const bucketName = 'requiredlib'; // Replace with your bucket name
        const objectKey = stock+'output.csv'; // Define the S3 object key without 's3://'

        const params = {
            Bucket: bucketName,
            Key: objectKey,
            Body: csv,
            ContentType: 'text/csv'
        };

        try {
            await s3.putObject(params).promise(); // Use promise to handle async
            console.log(`CSV uploaded successfully for ${stock}.`);
        } catch (err) {
            console.error('Error uploading CSV:', err);
        }

        const currentPrice = priceHistory.meta.regularMarketPrice;
        const fiftyTwoWeekHigh = priceHistory.meta.fiftyTwoWeekHigh;

        // Check if the values are valid
        if (!currentPrice || !fiftyTwoWeekHigh) {
            console.warn("Invalid price data.");
            continue; // Skip to the next stock
        }

        // Calculate the percent dip
        const percentDip = ((fiftyTwoWeekHigh - currentPrice) / fiftyTwoWeekHigh) * 100;

        console.log(`Dip for ${stock}: ${percentDip}`);
        if (percentDip > maxPercentDip) {
            stockInfoList.push({
                ticker: stock,
                currentPrice: currentPrice,
                allTimeHigh: fiftyTwoWeekHigh,
                percentDip: percentDip
            });
        }
    }

    return stockInfoList;
}

  

async function sendEmail(stockDipList) {
  const todayDate = moment().tz('Asia/Kolkata').format('YYYY-MM-DD');
  const params = {
    Source: emailSender,
    Destination: {
      ToAddresses: emailReceivers
    },
    Message: {
      Subject: {
        Charset: 'UTF-8',
        Data: `FAANG Stocks Dip More than ${maxPercentDip}% detected on ${todayDate}`
      },
      Body: {
        Text: {
          Charset: 'UTF-8',
          Data: `Below are the FAANG stocks that dipped more than ${maxPercentDip}% from their 52-week high: \n\n${JSON.stringify(stockDipList, null, 2)} \n\n-from my lambda`
        }
      }
    }
  };

  console.log('Sending email with stock dip information...');
  
  // Send email using AWS SES
  try {
    const response = await ses.sendEmail(params).promise();
    console.log(`Successfully sent email: ${JSON.stringify(response, null, 2)}`);
} catch (error) {
    console.error('There is an error while sending email: ', error);
}

}
