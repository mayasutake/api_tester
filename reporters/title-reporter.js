class TitleReporter {
  constructor() {
    this.counter = 0;
    this.colors = {
      reset: '\u001b[0m',
      green: '\u001b[32m',
      red: '\u001b[31m',
      gray: '\u001b[90m',
      white: '\u001b[37m',
    };
  }

  splitTitleAndUrl(rawTitle) {
    const [title, url = ''] = rawTitle.split('|||');
    return { title, url };
  }

  truncateToSingleLine(text, maxLength) {
    const normalized = String(text || '').replace(/[\r\n\t]+/g, ' ').trim();
    if (!normalized) {
      return '';
    }
    if (normalized.length <= maxLength) {
      return normalized;
    }
    return `${normalized.slice(0, maxLength - 3)}...`;
  }

  truncateByTerminalWidth(text, usedWidth) {
    const normalized = String(text || '').replace(/[\r\n\t]+/g, ' ').trim();
    if (!normalized) {
      return '';
    }

    const terminalWidth = Number(process.stdout.columns) || 120;
    // Wrapを避けるために余白を確保
    const safetyMargin = 10;
    const available = Math.max(0, terminalWidth - usedWidth - safetyMargin);

    if (available <= 0) {
      return '';
    }
    if (this.displayWidth(normalized) <= available) {
      return normalized;
    }
    if (available <= 3) {
      return '.'.repeat(available);
    }

    let out = '';
    for (const ch of normalized) {
      const next = out + ch;
      if (this.displayWidth(next) > available - 3) {
        break;
      }
      out = next;
    }
    return `${out}...`;
  }

  displayWidth(text) {
    let width = 0;
    for (const ch of String(text || '')) {
      width += ch.charCodeAt(0) > 0xff ? 2 : 1;
    }
    return width;
  }

  onTestBegin(test) {
    this.counter += 1;
    test._sequenceNumber = this.counter;
  }

  onTestEnd(test, result) {
    const { title, url } = this.splitTitleAndUrl(test.title);
    const shortTitle = this.truncateToSingleLine(title, 56);
    const sequence = String(test._sequenceNumber || 0).padStart(3, '0');
    const isPassed = result.status === 'passed';
    const mark = isPassed ? '✓' : '✗';
    const { reset, green, red, gray, white } = this.colors;
    const markColor = isPassed ? green : red;
    const durationPlain = `(${result.duration}ms)`;
    const basePlain = `${mark} ${sequence} ${shortTitle} ${durationPlain}`;
    const shortUrl = this.truncateByTerminalWidth(url, this.displayWidth(basePlain) + 1);
    const duration = `${gray}${durationPlain}${reset}`;
    const withUrl = shortUrl ? ` ${white}${shortUrl}${reset}` : '';

    console.log(`${markColor}${mark}${reset} ${gray}${sequence}${reset} ${shortTitle} ${duration}${withUrl}`);
  }

  onEnd(result) {
    const statusLabel = result.status === 'passed' ? 'PASSED' : result.status.toUpperCase();
    const { reset, green, red } = this.colors;
    const color = result.status === 'passed' ? green : red;
    console.log(`${color}[RESULT] ${statusLabel}${reset}`);
  }
}

module.exports = TitleReporter;
