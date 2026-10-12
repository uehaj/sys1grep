// A small demo service: an entry point calls through a few layers down to where things can go wrong.
export async function main() {
  await handleRequest();
}

async function handleRequest() {
  try {
    await processOrder();
  } catch (err) {
    throw err;
  }
}

async function processOrder() {
  await chargeCard();
}

async function chargeCard() {
  if (!cardIsValid()) fatal('card declined');
  throw new Error('card declined');
}

function cardIsValid() {
  return false;
}

function fatal(message) {
  console.error(message);
  process.exit(1);
}

// reads the API key from the environment first, then a local settings file
function loadApiKey() {
  return process.env.SYS1GREP_API_KEY || readSettingsFile().apiKey;
}

function readSettingsFile() {
  return { apiKey: '' };
}

function tryOptionalStep() {
  try {
    riskyStep();
  } catch (err) {
    // ignored: this step is optional and failing it is not fatal
  }
}

function riskyStep() {
  return true;
}
