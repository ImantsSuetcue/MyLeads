const app = require('./app');
const env = require('./config/env');

app.listen(env.PORT, () => {
  console.log(`MyLeads backend listening on http://localhost:${env.PORT} (MOCK_MODE=${env.MOCK_MODE})`);
});
