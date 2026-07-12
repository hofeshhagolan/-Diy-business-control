const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];

  page.on('pageerror', error => errors.push(error.message));
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(msg.text());
  });

  try {
    await page.goto('http://127.0.0.1:8000/', { waitUntil: 'load' });

    const pageTitle = await page.title();
    const authVisible = await page.isVisible('#authScreen');
    const appShellVisible = await page.isVisible('#appShell');
    const loginFormVisible = await page.isVisible('#loginForm');
    const signupFormHidden = await page.isHidden('#signupForm');
    const loginTabExists = await page.isVisible('#loginTab');
    const signupTabExists = await page.isVisible('#signupTab');
    const quickAddButtonExists = await page.isHidden('#quickAddButton');

    console.log(JSON.stringify({
      pageTitle,
      authVisible,
      appShellVisible,
      loginFormVisible,
      signupFormHidden,
      loginTabExists,
      signupTabExists,
      quickAddButtonExists,
      errors
    }));
  } catch (err) {
    console.error('FATAL', err.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
