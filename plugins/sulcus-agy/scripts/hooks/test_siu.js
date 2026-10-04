const { getSulcusConfig, sulcusRequest } = require('../core/sulcus_api.js');
async function test() {
  const config = getSulcusConfig();
  try {
    const res = await sulcusRequest(config, 'POST', '/api/v2/siu/label', {
      text: "I really love eating pizza.",
      quality_only: false
    });
    console.log(JSON.stringify(res, null, 2));
  } catch (e) {
    console.error("ERROR", e);
  }
}
test();
