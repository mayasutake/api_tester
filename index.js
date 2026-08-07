// run-test.js
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

// 1. コマンドライン引数の取得
// process.argv[2] = 'record-old' | 'record-new' | 'compare'
// process.argv[3] = API名 (例: yukonavi)
// process.argv[4] = 絞り込みキーワード (例: 'ホテル' や 'detail') ※任意
const mode = process.argv[2];
const apiName = process.argv[3];
const filterKeyword = process.argv[4] || '';

if (!apiName) {
  console.error('❌ エラー: API名を指定してください。(例: npm run old yukonavi)');
  process.exit(1);
}

// 2. test-cases/<apiName>.txt の存在確認
const testFilePath = path.resolve(process.cwd(), 'test-cases', `${apiName}.txt`);

if (!fs.existsSync(testFilePath)) {
  console.error(`❌ エラー: テスト定義ファイル "${testFilePath}" が見つかりません。`);
  process.exit(1);
}

// 3. テスト定義ファイルの独自パース処理
const fileContent = fs.readFileSync(testFilePath, 'utf-8');
const lines = fileContent.split(/\r?\n/);

const envVars = {};
let caseIndex = 1;
let currentSection = 'default';

function buildDefaultTestName(index) {
  return `TEST${String(index).padStart(3, '0')}`;
}

for (let line of lines) {
  // インラインコメント (# 以降) を除去し、前後の空白をトリム
  const cleanLine = line.split('#')[0].trim();
  
  if (!cleanLine) continue;

  // イコール判定 (BASE_URL等の設定値)
  // 注: KEY=VALUE形式で、KEYが英数字とアンダースコア_で始まる場合のみ設定値と判定
  // URLのクエリパラメータ（?key=value）は除外
  if (/^[A-Z_][A-Z0-9_]*=/.test(cleanLine)) {
    const [key, ...valParts] = cleanLine.split('=');
    envVars[key.trim()] = valParts.join('=').trim();
    continue;
  }

  // [セクション名] 形式の見出しを受け付ける
  const sectionMatch = cleanLine.match(/^\[(.+)\]$/);
  if (sectionMatch) {
    currentSection = sectionMatch[1].trim();
    continue;
  }

  // テストケース行のパース
  let testName = '';
  let relativePath = '';

  if (cleanLine.includes(',')) {
    // カンマあり: [テスト名, 相対URL]
    const parts = cleanLine.split(',').map(s => s.trim());
    testName = parts[0];
    relativePath = parts.slice(1).join(','); // URL内にカンマが含まれていても結合
  } else {
    // カンマなし (テスト名省略): 相対URLのみ
    testName = buildDefaultTestName(caseIndex);
    relativePath = cleanLine;
  }

  if (!testName) {
    testName = buildDefaultTestName(caseIndex);
  }

  // 日本語や省略に対応するため、安全な一意のキー（PATH_1, PATH_2...）を生成
  // テスト名・相対URL・セクション名を JSON で格納
  const key = `PATH_${caseIndex}`;
  envVars[key] = JSON.stringify({
    sectionName: currentSection,
    testName,
    relativePath,
  });
  caseIndex++;
}

// 4. 絞り込みフィルター処理 (テスト名またはURLでの部分一致)
if (filterKeyword) {
  let matchCount = 0;

  for (const [key, value] of Object.entries(envVars)) {
    if (key.startsWith('PATH_')) {
      let sectionName = '';
      let testName = '';
      let relativePath = '';

      try {
        const parsed = JSON.parse(value);
        sectionName = parsed.sectionName || '';
        testName = parsed.testName || '';
        relativePath = parsed.relativePath || '';
      } catch {
        // 旧形式との後方互換: testName::relativePath
        const parts = value.split('::');
        testName = parts[0] || '';
        relativePath = parts[1] || '';
      }

      const isMatched = testName.toLowerCase().includes(filterKeyword.toLowerCase()) || 
                        relativePath.toLowerCase().includes(filterKeyword.toLowerCase()) ||
                        sectionName.toLowerCase().includes(filterKeyword.toLowerCase());

      if (!isMatched) {
        delete envVars[key];
      } else {
        matchCount++;
      }
    }
  }

  if (matchCount === 0) {
    console.warn(`⚠️ 検索ワード "${filterKeyword}" にマッチするケースがありませんでした。`);
    process.exit(0);
  }

  console.log(`🔍 絞り込み実行: "${filterKeyword}" にマッチした ${matchCount} 件を実行します。`);
} else {
  console.log(`🚀 全件実行: testcases/${apiName}.txt のテストを開始します。`);
}

// 5. Playwright をキック
try {
  execSync('npx playwright test --reporter=./reporters/title-reporter.js', {
    stdio: 'inherit',
    env: {
      ...process.env,
      ...envVars,
      MODE: mode,
      API_NAME: apiName,
    },
  });
} catch (error) {
  process.exit(1);
}
