import fs from 'fs';
import path from 'path';
import archiver from 'archiver';
import FormData from 'form-data';
import axios from 'axios';
import dotenv from 'dotenv';
import { chromium } from 'playwright';

dotenv.config();

// --- CẤU HÌNH ---
const APP_ID = process.env.APP_ID || '1512032299590111735808';
const SPACE_ID = process.env.SPACE_ID || '1532032282325149028352';
const CHANNEL_CODE = process.env.CHANNEL_CODE || '1611947948265195581440';

const LOGIN_URL = process.env.LOGIN_URL || 'https://poc.superapp-intl.com/superapp#/login?redirect=https%3A%2F%2Fpoc.superapp-intl.com%2Fsuperapp&type=login';
const MY_USERNAME = process.env.POC_USERNAME || '';
const MY_PASSWORD = process.env.POC_PASSWORD || '';

const FORCE_CONTINUE_ON_APPROVE =
  String(process.env.FORCE_CONTINUE_ON_APPROVE || 'false').toLowerCase() === 'true';
const POLL_INTERVAL_MS = Number(process.env.POLL_INTERVAL_MS || 30000);
const MAX_POLL_ATTEMPTS = Number(process.env.MAX_POLL_ATTEMPTS || 10);

const rootDir = process.cwd();
const zipFilePath = path.join(rootDir, 'dist.zip');
const distFolderPath = path.join(rootDir, 'dist');

let TARGET_VERSION = '';
let COOKIE = '';

const PASS_STATUSES = new Set(['PASSED', 'PASS', 'APPROVED']);
const FAIL_STATUSES = new Set(['REJECTED', 'FAILED', 'CANCELLED']);

function buildHeaders() {
  return {
    Cookie: COOKIE,
    Host: 'poc.superapp-intl.com',
    'Bx-V': process.env.BX_V || '2.5.36',
    Accept: 'application/json, text/plain, */*',
    Origin: 'https://poc.superapp-intl.com',
    Referer: 'https://poc.superapp-intl.com/superapp',
    'User-Agent':
      process.env.USER_AGENT ||
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',

    'Sec-Ch-Ua':
      process.env.SEC_CH_UA || '"Chromium";v="146", "Not-A.Brand";v="24", "Google Chrome";v="146"',
    'Sec-Ch-Ua-Mobile': process.env.SEC_CH_UA_MOBILE || '?0',
    'Sec-Ch-Ua-Platform': process.env.SEC_CH_UA_PLATFORM || '"Windows"',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',

    'Logger-Account': process.env.LOGGER_ACCOUNT || '',
    'Logger-Account-Id': process.env.LOGGER_ACCOUNT_ID || '',
    'Logger-Role': process.env.LOGGER_ROLE || '',
    'Logger-Space': process.env.LOGGER_SPACE || '',
    'Logger-User-Id': process.env.LOGGER_USER_ID || '',
    'Logger-User-Nick': process.env.LOGGER_USER_NICK || ''
  };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function incrementVersion(current) {
  let [major, minor, patch] = String(current).split('.').map(Number);

  if ([major, minor, patch].some((n) => Number.isNaN(n))) {
    throw new Error(`Version hiện tại không hợp lệ: ${current}`);
  }

  patch += 1;
  if (patch > 9) {
    patch = 0;
    minor += 1;
  }
  if (minor > 9) {
    minor = 0;
    major += 1;
  }

  return `${major}.${minor}.${patch}`;
}

function normalizeStatus(status) {
  return String(status || '').trim().toUpperCase();
}

function ensureEnv() {
  if (!MY_USERNAME || !MY_PASSWORD) {
    throw new Error('Thiếu POC_USERNAME hoặc POC_PASSWORD trong file .env');
  }

  if (!fs.existsSync(distFolderPath)) {
    throw new Error(`Không tìm thấy thư mục dist tại: ${distFolderPath}`);
  }
}

function maskCookie(cookie) {
  if (!cookie) return '(empty)';
  if (cookie.length <= 20) return cookie;
  return `${cookie.slice(0, 10)}...${cookie.slice(-10)}`;
}

function safeJsonStringify(obj) {
  try {
    return JSON.stringify(obj, null, 2);
  } catch {
    return '[Cannot stringify payload]';
  }
}

function summarizeBody(body) {
  if (!body) return '(empty)';
  if (typeof body === 'string') return body.slice(0, 1000);
  if (typeof body === 'object') return safeJsonStringify(body).slice(0, 2000);
  return String(body).slice(0, 1000);
}

async function getAutoCookie() {
    console.log('🤖 [0/8]: Đang gọi Robot Playwright đi lấy Cookie...');
  
    const browser = await chromium.launch({
      headless: String(process.env.HEADLESS || 'false').toLowerCase() === 'true'
    });
  
    const context = await browser.newContext();
    const page = await context.newPage();
  
    try {
      await page.goto(LOGIN_URL, {
        waitUntil: 'domcontentloaded',
        timeout: 120000
      });
  
      console.log('👀 Đã mở trang đăng nhập...');
      console.log(`🌍 Current URL: ${page.url()}`);
  
      await page.waitForTimeout(3000);
      await page.waitForSelector('#username', { timeout: 30000 });
      await page.waitForSelector('#password', { timeout: 30000 });
  
      console.log('👀 Đang điền tài khoản...');
      await page.fill('#username', MY_USERNAME);
  
      console.log('👀 Đang điền mật khẩu...');
      await page.fill('#password', MY_PASSWORD);
  
      console.log('👀 Đang submit form...');
      await page.locator('#password').press('Enter');
  
      // ĐỪNG chờ networkidle, chỉ cần chờ app chuyển qua overview
      await page.waitForURL(/#\/overview/i, { timeout: 120000 });
      await page.waitForTimeout(3000);
  
      console.log(`🌍 URL sau login: ${page.url()}`);
  
      const cookies = await context.cookies('https://poc.superapp-intl.com');
      const cookieString = cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  
      if (!cookieString) {
        throw new Error('Không lấy được Cookie!');
      }
  
      console.log('✅ Đã lấy Cookie thành công!');
      console.log(`🍪 Cookie preview: ${maskCookie(cookieString)}`);
  
      await browser.close();
      return cookieString;
    } catch (err) {
      console.error('❌ Lỗi lúc Playwright tự đăng nhập:', err.message || err);
      console.log('🛑 Giữ nguyên browser để bạn kiểm tra thủ công...');
      throw err;
    }
  }

async function loginAndGetCookie() {
  COOKIE = await getAutoCookie();
}

async function fetchJson(step, url, options = {}) {
  const finalOptions = {
    ...options,
    headers: {
      ...(options.headers || {})
    }
  };

  const method = finalOptions.method || 'GET';
  const requestBodyPreview =
    finalOptions.body && typeof finalOptions.body !== 'string'
      ? '[non-string body]'
      : summarizeBody(finalOptions.body);

  console.log(`\n🌐 [${step}] ${method} ${url}`);
  if (method !== 'GET') {
    console.log(`🧾 [${step}] Request body preview: ${requestBodyPreview}`);
  }

  let res;
  let text;

  try {
    res = await fetch(url, finalOptions);
    text = await res.text();
  } catch (error) {
    throw new Error(`[${step}] fetch failed: ${error?.message || error}`);
  }

  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(
      `[${step}] Response không phải JSON | HTTP ${res.status} ${res.statusText} | ${text.slice(0, 500)}`
    );
  }

  if (!res.ok) {
    const traceId = json?.traceId || '(no traceId)';
    throw new Error(
      `[${step}] HTTP ${res.status} ${res.statusText} | traceId=${traceId} | response=${safeJsonStringify(json)}`
    );
  }

  return json;
}

function assertSuccess(step, result) {
  const errorCode = String(result?.errorCode || '').trim();
  const errorMsg = String(result?.errorMsg || '').trim();

  if (errorCode === '401' || /not login/i.test(errorMsg) || result?.data?.loginUrl) {
    throw new Error(
      `[${step}] Session hết hạn hoặc chưa đăng nhập. Response: ${safeJsonStringify(result)}`
    );
  }

  if (!result?.success) {
    const traceId = result?.traceId || '(no traceId)';
    throw new Error(
      `[${step}] fail | traceId=${traceId} | response=${safeJsonStringify(result)}`
    );
  }

  return result;
}

function getListData(result) {
  if (Array.isArray(result?.data?.list)) return result.data.list;
  if (Array.isArray(result?.data)) return result.data;
  if (result?.data && typeof result.data === 'object') return [result.data];
  return [];
}

function findVersionItem(result, version) {
  const list = getListData(result);
  return (
    list.find(
      (item) =>
        String(item?.version || item?.name || '').trim() === String(version).trim()
    ) || null
  );
}

function getItemStatus(item) {
  if (!item) return null;

  return normalizeStatus(
    item.versionStatus ?? item.status ?? item.approveStatus ?? item.publishStatus ?? null
  );
}

async function fetchAndPrepareVersion() {
  console.log('🔍 Đang lấy version hiện tại từ API query...');

  const queryUrl = `https://poc.superapp-intl.com/rest/intercnn/app/version/query?currentPage=1&pageSize=10&appId=${APP_ID}&spaceId=${SPACE_ID}`;

  const result = await fetchJson('fetchAndPrepareVersion', queryUrl, { headers: buildHeaders() });
  assertSuccess('fetchAndPrepareVersion', result);

  const list = getListData(result);
  if (!list.length) {
    throw new Error('Không lấy được danh sách version hiện tại.');
  }

  const latest = list[0]?.version;
  if (!latest) {
    throw new Error(`Không tìm thấy version hợp lệ trong response: ${safeJsonStringify(result)}`);
  }

  TARGET_VERSION = incrementVersion(latest);
  console.log(`✅ Version hiện tại: ${latest} -> Tăng lên version mới: ${TARGET_VERSION}`);
}

async function zipFolder() {
  return new Promise((resolve, reject) => {
    console.log('📦 1/8: Đang nén thư mục dist...');

    if (fs.existsSync(zipFilePath)) {
      fs.unlinkSync(zipFilePath);
    }

    const output = fs.createWriteStream(zipFilePath);
    const archive = archiver('zip', { zlib: { level: 9 } });

    output.on('close', () => {
      console.log(`✅ Đã tạo ${zipFilePath} (${archive.pointer()} bytes)`);
      resolve();
    });

    output.on('error', reject);
    archive.on('error', reject);

    archive.pipe(output);
    archive.directory(distFolderPath, false);
    archive.finalize();
  });
}

async function uploadZip() {
  console.log('☁️ 2/8: Đang upload file zip...');

  if (!fs.existsSync(zipFilePath)) {
    throw new Error(`Không tìm thấy file zip: ${zipFilePath}`);
  }

  const stat = fs.statSync(zipFilePath);
  console.log(`📦 File upload: ${zipFilePath}`);
  console.log(`📏 Size: ${stat.size} bytes`);
  console.log(`🏷️ Version upload: ${TARGET_VERSION}`);

  const form = new FormData();
  form.append('spaceId', SPACE_ID);
  form.append('appId', APP_ID);
  form.append('version', TARGET_VERSION);
  form.append('file', fs.createReadStream(zipFilePath), {
    filename: `${APP_ID}_v${TARGET_VERSION}_poc.zip`,
    contentType: 'application/zip'
  });

  const headers = {
    ...buildHeaders(),
    ...form.getHeaders()
  };

  try {
    const response = await axios.post(
      'https://poc.superapp-intl.com/rest/intercnn/app/version/uploadResource',
      form,
      {
        headers,
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        validateStatus: () => true
      }
    );

    const result = response.data;

    if (response.status < 200 || response.status >= 300) {
      const traceId = result?.traceId || '(no traceId)';
      throw new Error(
        `[uploadZip] HTTP ${response.status} | traceId=${traceId} | response=${safeJsonStringify(result)}`
      );
    }

    return assertSuccess('uploadZip', result);
  } catch (error) {
    if (error.response) {
      const result = error.response.data;
      const traceId = result?.traceId || '(no traceId)';
      throw new Error(
        `[uploadZip] HTTP ${error.response.status} | traceId=${traceId} | response=${safeJsonStringify(result)}`
      );
    }

    throw new Error(`[uploadZip] axios failed: ${error.message}`);
  }
}

async function createVersion() {
  console.log(`📝 3/8: Đang khởi tạo app version ${TARGET_VERSION}...`);

  const artifactPath = `app/version/${APP_ID}/${TARGET_VERSION}/${APP_ID}_v${TARGET_VERSION}_poc.zip`;
  const payload = {
    appId: APP_ID,
    artifactList: [artifactPath],
    artifactType: 'FILE',
    name: TARGET_VERSION,
    source: 'UPLOAD',
    version: TARGET_VERSION
  };

  const result = await fetchJson(
    'createVersion',
    'https://poc.superapp-intl.com/rest/intercnn/app/version/create',
    {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  return assertSuccess('createVersion', result);
}

async function createPublishVersion() {
  console.log(`📣 4/8: Tạo publish version cho channel ${CHANNEL_CODE}...`);

  const artifactPath = `app/version/${APP_ID}/${TARGET_VERSION}/${APP_ID}_v${TARGET_VERSION}_poc.zip`;
  const payload = {
    appId: APP_ID,
    channelCode: CHANNEL_CODE,
    version: TARGET_VERSION,
    changelog: '',
    artifactType: 'FILE',
    artifactList: [artifactPath]
  };

  const result = await fetchJson(
    'createPublishVersion',
    'https://poc.superapp-intl.com/rest/intercnn/app/publish/version/create',
    {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  return assertSuccess('createPublishVersion', result);
}

async function updateApp() {
  console.log('🔄 5/8: Cập nhật metadata App...');

  const payload = {
    appId: APP_ID,
    description: {
      name: 'Smart Home',
      icon: 'icon/app/ad9f6f2cf33142f7ae4df049d2823586.jpg',
      iconPublicUrl:
        'https://superapp-poc-sg-oss.oss-ap-southeast-1.aliyuncs.com/icon/app/ad9f6f2cf33142f7ae4df049d2823586.jpg?Expires=1774938000&OSSAccessKeyId=LTAI5tAhMLjDUTTaLN1qQ29k&Signature=FJbMTwkSQb0EAZ7DXR%2BY0r8npRw%3D'
    }
  };

  const result = await fetchJson(
    'updateApp',
    'https://poc.superapp-intl.com/rest/intercnn/app/update',
    {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  return assertSuccess('updateApp', result);
}

async function startApprove() {
  console.log('🚀 6/8: Gửi phê duyệt Release...');

  const payload = {
    appId: APP_ID,
    sourceSpaceId: SPACE_ID,
    channelCode: CHANNEL_CODE,
    version: TARGET_VERSION
  };

  const result = await fetchJson(
    'startApprove',
    'https://poc.superapp-intl.com/rest/intercnn/app/publish/version/startApprove',
    {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );

  return assertSuccess('startApprove', result);
}

async function queryPublishStatus() {
  const params = new URLSearchParams({
    appId: APP_ID,
    channelCode: CHANNEL_CODE,
    version: TARGET_VERSION,
    currentPage: '1',
    pageSize: '20'
  });

  const url = `https://poc.superapp-intl.com/rest/intercnn/app/publish/version/query?${params.toString()}`;
  const result = await fetchJson('queryPublishStatus', url, { headers: buildHeaders() });
  return assertSuccess('queryPublishStatus', result);
}

async function queryPublishHistory() {
  const params = new URLSearchParams({
    appId: APP_ID,
    channelCode: CHANNEL_CODE,
    version: TARGET_VERSION
  });

  const url = `https://poc.superapp-intl.com/rest/intercnn/app/publish/version/history/query?${params.toString()}`;
  const result = await fetchJson('queryPublishHistory', url, { headers: buildHeaders() });
  return assertSuccess('queryPublishHistory', result);
}

async function skipBetaAndOnline() {
  const payload = {
    appId: APP_ID,
    sourceSpaceId: SPACE_ID,
    channelCode: CHANNEL_CODE,
    version: TARGET_VERSION
  };

  console.log('\n⏩ 7/8: Đang gọi Skip Beta...');
  const skipBetaResult = await fetchJson(
    'skipBeta',
    'https://poc.superapp-intl.com/rest/intercnn/app/publish/version/gray/skipBeta',
    {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  assertSuccess('skipBeta', skipBetaResult);
  console.log('✅ Skip Beta thành công.');

  console.log('🌐 8/8: Đang Online...');
  const onlineResult = await fetchJson(
    'online',
    'https://poc.superapp-intl.com/rest/intercnn/app/publish/online',
    {
      method: 'POST',
      headers: {
        ...buildHeaders(),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    }
  );
  assertSuccess('online', onlineResult);
  console.log('✅ Online thành công.');
}

async function checkStatusAndPublish(startApproveResult) {
  console.log(
    `⏳ Đang theo dõi trạng thái approve (mỗi ${Math.round(
      POLL_INTERVAL_MS / 1000
    )}s, tối đa ${MAX_POLL_ATTEMPTS} lần)...`
  );

  const startStatus = getItemStatus(startApproveResult?.data || startApproveResult);
  const startStatusDesc = startApproveResult?.data?.versionStatusDesc || '';
  if (startStatus) {
    console.log(
      `ℹ️ Status ngay sau startApprove: ${startStatus}${
        startStatusDesc ? ` (${startStatusDesc})` : ''
      }`
    );
  }

  let lastStatus = null;

  for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt += 1) {
    if (attempt > 1) {
      await sleep(POLL_INTERVAL_MS);
    }

    try {
      const queryResult = await queryPublishStatus();
      const item = findVersionItem(queryResult, TARGET_VERSION);
      const status = getItemStatus(item);

      if (!item) {
        const historyResult = await queryPublishHistory();
        const latestHistory = getListData(historyResult)[0] || null;
        const historyType = latestHistory?.type || 'UNKNOWN';
        process.stdout.write(
          `... Version: ${TARGET_VERSION} | Status: [NOT_FOUND] | LastHistory: [${historyType}]                    \r`
        );
        continue;
      }

      const statusDesc = item.versionStatusDesc || item.statusDesc || '';
      if (status !== lastStatus) {
        console.log(
          `\n🔄 Status đổi: ${lastStatus || 'UNKNOWN'} -> ${status || 'UNKNOWN'}${
            statusDesc ? ` (${statusDesc})` : ''
          }`
        );
        lastStatus = status;
      }

      process.stdout.write(
        `... Version: ${TARGET_VERSION} | Status: [${status || 'UNKNOWN'}]                    \r`
      );

      if (PASS_STATUSES.has(status)) {
        console.log(`\n✅ Trạng thái cho phép đi tiếp: ${status}`);
        await skipBetaAndOnline();
        return;
      }

      if (status === 'APPROVE' && FORCE_CONTINUE_ON_APPROVE) {
        console.log('\n⚠️ Status hiện tại là APPROVE. Sẽ thử gọi Skip Beta + Online luôn.');
        try {
          await skipBetaAndOnline();
          return;
        } catch (publishError) {
          console.log(`⚠️ Backend chưa cho đi tiếp: ${publishError.message}`);
          console.log('↩️ Quay lại polling tiếp...');
        }
      }

      if (FAIL_STATUSES.has(status)) {
        throw new Error(`Release bị fail với status=${status}`);
      }
    } catch (error) {
      console.error(`\n❌ Lỗi check status (lần ${attempt}/${MAX_POLL_ATTEMPTS}): ${error.message}`);
    }
  }

  throw new Error(
    `Hết thời gian chờ. Version ${TARGET_VERSION} vẫn chưa sang trạng thái cho phép publish.`
  );
}

async function startDeploy() {
  try {
    ensureEnv();

    console.log('='.repeat(80));
    console.log('🚀 START DEPLOY');
    console.log(`APP_ID: ${APP_ID}`);
    console.log(`SPACE_ID: ${SPACE_ID}`);
    console.log(`CHANNEL_CODE: ${CHANNEL_CODE}`);
    console.log(`DIST: ${distFolderPath}`);
    console.log('='.repeat(80));

    await loginAndGetCookie();
    await fetchAndPrepareVersion();
    await zipFolder();
    await uploadZip();

    const createVersionResult = await createVersion();
    console.log(
      '📝 createVersion response:',
      safeJsonStringify(createVersionResult?.data || createVersionResult)
    );

    const createPublishResult = await createPublishVersion();
    console.log(
      '📣 createPublishVersion response:',
      safeJsonStringify(createPublishResult?.data || createPublishResult)
    );

    await updateApp();

    const approveResult = await startApprove();
    console.log(
      '📨 startApprove response:',
      safeJsonStringify(approveResult?.data || approveResult)
    );

    await checkStatusAndPublish(approveResult);

    console.log(`\n🎉 THÀNH CÔNG! Version ${TARGET_VERSION} đã ONLINE.`);
  } catch (err) {
    console.error('\n❌ LỖI:', err.message);
    process.exitCode = 1;
  }
}

startDeploy();