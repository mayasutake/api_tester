import { test, expect } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const MODE = process.env.MODE || 'test';
const API_NAME = process.env.API_NAME || 'default';
const API_KEY = process.env.API_KEY || '';
const COMPARE_UNORDERED_PATHS = process.env.COMPARE_UNORDERED_PATHS || '';
const COMPARE_SORT_KEYS = process.env.COMPARE_SORT_KEYS || '';

const BASE_URL = MODE === 'record-old'
  ? process.env.OLD_BASE_URL
  : process.env.NEW_BASE_URL;

const unorderedArrayPaths = new Set(
  COMPARE_UNORDERED_PATHS
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean),
);

type SortKeyMap = Record<string, string[]>;

function parseSortKeyMap(raw: string): SortKeyMap {
  if (!raw.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('COMPARE_SORT_KEYS は {"$.path":["key"]} 形式のJSONを指定してください。');
      return {};
    }

    const result: SortKeyMap = {};
    for (const [pathKey, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) {
        continue;
      }
      const normalizedKeys = value
        .filter((item) => typeof item === 'string')
        .map((item) => item.trim())
        .filter(Boolean);
      if (normalizedKeys.length > 0) {
        result[pathKey] = normalizedKeys;
      }
    }
    return result;
  } catch {
    console.warn('COMPARE_SORT_KEYS のJSON解析に失敗したため、ソートキー指定なしで比較します。');
    return {};
  }
}

const sortKeysByPath = parseSortKeyMap(COMPARE_SORT_KEYS);

function comparePrimitive(a: unknown, b: unknown): number {
  const aText = a === undefined ? '' : JSON.stringify(a);
  const bText = b === undefined ? '' : JSON.stringify(b);

  if (aText < bText) {
    return -1;
  }
  if (aText > bText) {
    return 1;
  }
  return 0;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  }

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  const pairs = keys.map((key) => `${JSON.stringify(key)}:${stableStringify(obj[key])}`);
  return `{${pairs.join(',')}}`;
}

function compareArrayItems(a: unknown, b: unknown, sortKeys: string[]): number {
  if (sortKeys.length > 0 && a && b && typeof a === 'object' && typeof b === 'object') {
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;

    for (const key of sortKeys) {
      const diff = comparePrimitive(aObj[key], bObj[key]);
      if (diff !== 0) {
        return diff;
      }
    }
  }

  return comparePrimitive(stableStringify(a), stableStringify(b));
}

function normalizeForCompare(value: unknown, currentPath = '$'): unknown {
  if (Array.isArray(value)) {
    const normalizedItems = value.map((item) => normalizeForCompare(item, `${currentPath}[]`));

    if (!unorderedArrayPaths.has(currentPath)) {
      return normalizedItems;
    }

    const sortKeys = sortKeysByPath[currentPath] || [];
    return [...normalizedItems].sort((a, b) => compareArrayItems(a, b, sortKeys));
  }

  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const normalizedObj: Record<string, unknown> = {};

    for (const key of keys) {
      const nextPath = currentPath === '$' ? `$.${key}` : `${currentPath}.${key}`;
      normalizedObj[key] = normalizeForCompare(obj[key], nextPath);
    }

    return normalizedObj;
  }

  return value;
}

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
      const normalizedActualJson = normalizeForCompare(actualJson);
      const normalizedExpectedJson = normalizeForCompare(expectedJson);
      expect(normalizedActualJson).toEqual(normalizedExpectedJson);
    }
  });
}
