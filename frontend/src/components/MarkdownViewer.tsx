import React from 'react';

interface MarkdownViewerProps {
  content: string;
}

export function MarkdownViewer({ content }: MarkdownViewerProps) {
  const lines = content.split('\n');
  const elements: React.ReactNode[] = [];
  let tableRows: string[][] = [];
  let inTable = false;
  let inList = false;
  let listItems: string[] = [];

  const flushTable = (key: number) => {
    if (tableRows.length === 0) return null;
    const [header, ...rows] = tableRows;
    // Filter out separator row like |---|---|
    const cleanRows = rows.filter((r) => !r.every((cell) => cell.match(/^:?-+:?$/)));

    const tableEl = (
      <div
        key={`table-${key}`}
        className="my-4 overflow-x-auto rounded-lg border border-[rgba(0,240,255,0.3)] bg-[rgb(var(--bg-panel-rgb) / 0.6)] p-2"
      >
        <table className="w-full border-collapse text-left font-mono text-xs">
          <thead>
            <tr className="border-b border-[rgba(0,240,255,0.35)] text-[var(--accent-cyan)]">
              {header.map((cell, cIdx) => (
                <th key={cIdx} className="px-3 py-2 font-bold tracking-wider">
                  {renderInline(cell.trim())}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgb(var(--ink-rgb)/0.08)]">
            {cleanRows.map((row, rIdx) => (
              <tr key={rIdx}>
                {row.map((cell, cIdx) => (
                  <td key={cIdx} className="px-3 py-2 text-[var(--text-main)]">
                    {renderInline(cell.trim())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
    tableRows = [];
    inTable = false;
    return tableEl;
  };

  const flushList = (key: number) => {
    if (listItems.length === 0) return null;
    const listEl = (
      <ul
        key={`list-${key}`}
        className="my-3 space-y-1.5 pl-4 font-mono text-xs text-[var(--text-main)]"
      >
        {listItems.map((item, idx) => (
          <li key={idx} className="flex items-start gap-2">
            <span className="text-[var(--accent-pink)] select-none">▸</span>
            <span className="flex-1">{renderInline(item)}</span>
          </li>
        ))}
      </ul>
    );
    listItems = [];
    inList = false;
    return listEl;
  };

  const renderInline = (text: string): React.ReactNode => {
    // Replace **bold**, `code`, *italic*
    const parts: React.ReactNode[] = [];
    let remaining = text;

    let keyCounter = 0;
    while (remaining.length > 0) {
      // Bold **text**
      const boldMatch = remaining.match(/\*\*(.*?)\*\*/);
      // Code `text`
      const codeMatch = remaining.match(/`(.*?)`/);

      const firstMatch = [
        boldMatch?.index !== undefined
          ? { type: 'bold' as const, index: boldMatch.index, match: boldMatch }
          : null,
        codeMatch?.index !== undefined
          ? { type: 'code' as const, index: codeMatch.index, match: codeMatch }
          : null,
      ]
        .filter((m): m is NonNullable<typeof m> => m !== null)
        .sort((a, b) => a.index - b.index)[0];

      // Both regexes can miss (plain text with no markdown): the filtered array
      // is empty at runtime even though the type still claims a match exists.
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition
      if (!firstMatch) {
        parts.push(remaining);
        break;
      }

      if (firstMatch.index > 0) {
        parts.push(remaining.substring(0, firstMatch.index));
      }

      if (firstMatch.type === 'bold') {
        parts.push(
          <strong key={`b-${keyCounter++}`} className="font-bold text-[var(--accent-yellow)]">
            {firstMatch.match[1]}
          </strong>,
        );
      } else {
        parts.push(
          <code
            key={`c-${keyCounter++}`}
            className="rounded border border-[rgba(0,240,255,0.3)] bg-[rgba(0,240,255,0.15)] px-1.5 py-0.5 font-mono text-[0.78rem] text-[var(--accent-cyan)]"
          >
            {firstMatch.match[1]}
          </code>,
        );
      }

      remaining = remaining.substring(firstMatch.index + firstMatch.match[0].length);
    }

    return parts.length === 1 ? parts[0] : <>{parts}</>;
  };

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();

    // Table line: starts and ends with |
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      if (inList) {
        const listEl = flushList(i);
        if (listEl) elements.push(listEl);
      }
      inTable = true;
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim());
      tableRows.push(cells);
      continue;
    } else if (inTable) {
      const tableEl = flushTable(i);
      if (tableEl) elements.push(tableEl);
    }

    // List item: starts with - or *
    if (trimmed.startsWith('- ') || trimmed.startsWith('* ')) {
      inList = true;
      listItems.push(trimmed.slice(2));
      continue;
    } else if (inList) {
      const listEl = flushList(i);
      if (listEl) elements.push(listEl);
    }

    // Horizontal Rule
    if (trimmed === '---' || trimmed === '***' || trimmed === '___') {
      elements.push(
        <hr
          key={`hr-${i}`}
          className="my-5 h-[1px] border-0 bg-gradient-to-r from-transparent via-[rgba(0,240,255,0.4)] to-transparent"
        />,
      );
      continue;
    }

    // Headings
    if (trimmed.startsWith('# ')) {
      elements.push(
        <h1
          key={`h1-${i}`}
          className="font-display mt-2 mb-4 text-xl font-black tracking-wider text-(--text-main) [text-shadow:0_0_12px_var(--accent-cyan)]"
        >
          {renderInline(trimmed.slice(2))}
        </h1>,
      );
      continue;
    }
    if (trimmed.startsWith('## ')) {
      elements.push(
        <h2
          key={`h2-${i}`}
          className="font-display mt-6 mb-3 text-base font-black tracking-wide text-[var(--accent-pink)] [text-shadow:0_0_8px_rgba(255,0,127,0.5)]"
        >
          {renderInline(trimmed.slice(3))}
        </h2>,
      );
      continue;
    }
    if (trimmed.startsWith('### ')) {
      elements.push(
        <h3
          key={`h3-${i}`}
          className="font-display mt-4 mb-2 text-sm font-bold text-[var(--accent-cyan)]"
        >
          {renderInline(trimmed.slice(4))}
        </h3>,
      );
      continue;
    }

    // Empty lines
    if (trimmed === '') {
      continue;
    }

    // Regular Paragraph
    elements.push(
      <p
        key={`p-${i}`}
        className="my-2.5 font-mono text-xs leading-relaxed text-[var(--text-main)] opacity-90"
      >
        {renderInline(trimmed)}
      </p>,
    );
  }

  // Flush any lingering tables or lists at EOF
  if (inTable) {
    const tableEl = flushTable(lines.length);
    if (tableEl) elements.push(tableEl);
  }
  if (inList) {
    const listEl = flushList(lines.length);
    if (listEl) elements.push(listEl);
  }

  return <div className="space-y-1">{elements}</div>;
}
