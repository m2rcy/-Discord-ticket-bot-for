const fs = require('node:fs');
const path = require('node:path');

function loadPurchaseProducts() {
  const settingsPath = path.resolve(__dirname, '../settings.txt');
  const settingsText = fs.readFileSync(settingsPath, 'utf8');

  return settingsText.split(/\r?\n/).flatMap((line) => {
    const match = line.match(/^\s*([^=]+?)\s*=\s*(.*?)\s*$/);
    if (!match || /not\s+now/i.test(line)) return [];

    const [, value, rawDurations] = match;
    const durations = rawDurations
      .split(',')
      .map((label) => label.trim())
      .filter(Boolean)
      .map((label) => ({
        en: label,
      }));

    if (durations.length === 0) {
      throw new Error(`No valid durations configured for product "${value}" in settings.txt.`);
    }

    return [{ value: value.trim(), labels: { en: value.trim() }, durations }];
  });
}

const purchaseProducts = loadPurchaseProducts();

if (purchaseProducts.length === 0) {
  throw new Error('No purchase products configured in settings.txt.');
}

const purchasePaymentMethods = [
  { value: 'papara', en: 'Papara' },
  { value: 'bank_transfer', en: 'Bank transfer' },
  { value: 'crypto', en: 'Crypto' },
  { value: 'other', en: 'Other' },
];

const buyTranslations = {
  en: {
    buyModalTitle: 'Purchase Request',
    buyProductPrompt: 'Select the products you would like to purchase (up to 5):',
    buyDurationPrompt: 'Choose a duration for {product}:',
    productPlaceholder: 'Select products',
    durationPlaceholder: 'Select a duration',
    selectedProductsCount: 'Selected products: {count}',
    productProgress: 'Product {current}/{total}',
    continue: 'Continue',
    previous: 'Previous',
    finish: 'Create ticket',
    paymentPrompt: 'Choose your payment method:',
    paymentPlaceholder: 'Select a payment method',
    detailsPrompt: 'Enter your order details and any specific requests below.',
    orderSubjectPrompt: 'Order for {products}',
    confirmPurchase: 'Confirm purchase',
    purchaseDetailsModalTitle: 'Order Details',
    purchaseDetailsLabel: 'Order Details / Specific Requests',
    purchaseDetailsPlaceholder: 'Enter any additional details or requirements...',
    paymentField: 'Payment Method',
    selectionRequired: 'Please select at least one product to continue.',
    paymentSelectionRequired: 'Please choose a payment method before continuing.',
    purchaseFlowCompleted: 'Your purchase ticket has been created!',
    purchaseFlowUnavailable: 'Unable to complete the purchase flow. Please try again.',
  },
};

module.exports = {
  buyTranslations,
  purchasePaymentMethods,
  purchaseProducts,
};
