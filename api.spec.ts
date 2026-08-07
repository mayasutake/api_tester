import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MODE = process.env.MODE || 'test';
const API_NAME = process.env.API_NAME || 'default';
const API_KEY = process.env.API_KEY || '';

const BASE_URL = MODE === 'record-old'
  ? process.env.OLD_BASE_URL
  : process.env.NEW_BASE_URL;

function truncateForSingleLine(text: string, maxLength: number): string {
  const normalized = text.replace(/[\r\n\t]+/g, ' ').trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}...`;
}

function buildDisplayUrl(baseUrl: string | undefined, relativePath: string): string {
  if (/^https?:\/\//i.test(relativePath)) {
    return relativePath;
  }
  const normalizedBase = (baseUrl || '').replace(/\/+$/, '');
  const normalizedPath = relativePath.replace(/^\/+/, '');
  return `${normalizedBase}/${normalizedPath}`;
}

// process.env から PATH_ で始まる項目を抽出
const pathEntries = Object.entries(process.env)
  .filter(([key]) => key.startsWith('PATH_'))
  // 連番順に並び替え
  .sort(([keyA], [keyB]) => {
    const numA = parseInt(keyA.replace('PATH_', ''), 10);
    const numB = parseInt(keyB.replace('PATH_', ''), 10);
    return numA - numB;
  });

for (const [key, rawValue] of pathEntries) {
  const index = key.replace('PATH_', '');
  const numericIndex = parseInt(index, 10) || 0;
  let sectionName = 'default';
  let testName = '';
  let relativePath = '';

  try {
    const parsed = JSON.parse(rawValue);
    sectionName = parsed.sectionName || 'default';
    testName = parsed.testName || '';
    relativePath = parsed.relativePath || '';
  } catch {
    // 旧形式との後方互換: testName::relativePath
    const parts = rawValue.split('::');
    testName = parts[0] || '';
    relativePath = parts[1] || '';
  }

  if (!testName.trim()) {
    testName = `TEST${String(numericIndex).padStart(3, '0')}`;
  }

  // 保存用ファイル名: セクションはフォルダ、ファイル名はタイトルのみ
  // ファイル名に使えない不適切な文字を安全なアンダースコアに置換
  const safeSectionName = (sectionName || 'default').replace(/[\\/:*?"<>|]/g, '_');
  const safeTestName = testName.replace(/[\\/:*?"<>|]/g, '_');
  const safeFileName = `${safeTestName}.json`;

  const shortSectionName = truncateForSingleLine(sectionName, 16);
  const shortTestName = truncateForSingleLine(testName, 40);
  const displayTitle = `[${API_NAME}] [${shortSectionName}] ${shortTestName}`;
  const displayUrl = buildDisplayUrl(BASE_URL, relativePath);
  const titleWithMeta = `${displayTitle}|||${displayUrl}`;
  test(titleWithMeta, async ({ request }) => {
    const headers = {};
    if (API_KEY) {
      // API_KEY="ヘッダーキー: 値" 形式をパース
      const [headerKey, ...headerValueParts] = API_KEY.split(':');
      const headerValue = headerValueParts.join(':').trim();
      headers[headerKey.trim()] = headerValue;
    }

    const res = await request.get(`${BASE_URL}${relativePath}`, { headers });
    const actualJson = await res.json();

    // 保存先をモードに応じて変更
    let fixtureDir = '';
    if (MODE === 'record-old') {
      fixtureDir = 'old';
    } else if (MODE === 'record-new') {
      fixtureDir = 'new';
    } else if (MODE === 'compare') {
      fixtureDir = 'new';  // compareモード時は新APIを新フォルダに保存
    }
    const fixturePath = path.join(__dirname, 'fixtures', fixtureDir, API_NAME, safeSectionName, safeFileName);

    if (MODE === 'record-old' || MODE === 'record-new') {
      // record-old: 旧APIを保存
      // record-new: 新APIを保存
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      fs.writeFileSync(fixturePath, JSON.stringify(actualJson, null, 2));
    } else if (MODE === 'compare') {
      // compare: 新APIを保存して旧APIと比較
      fs.mkdirSync(path.dirname(fixturePath), { recursive: true });
      fs.writeFileSync(fixturePath, JSON.stringify(actualJson, null, 2));
      
      // 旧APIのレコードと比較
      const oldFixturePath = path.join(__dirname, 'fixtures', 'old', API_NAME, safeSectionName, safeFileName);
      if (!fs.existsSync(oldFixturePath)) {
        throw new Error(`比較対象のキャプチャファイル（旧API）が存在しません: ${oldFixturePath}\n先に 'npm run old ${API_NAME}' を実行してください。`);
      }
      const expectedJson = JSON.parse(fs.readFileSync(oldFixturePath, 'utf-8'));
      expect(actualJson).toEqual(expectedJson);
    }
  });
}
