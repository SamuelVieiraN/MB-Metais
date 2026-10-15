/*
 * Leitor e gerador mínimo de planilhas Excel (.xlsx), sem bibliotecas externas.
 *
 * Gerar:  XlsxLite.buildBytes(sheets)  ->  Uint8Array do arquivo .xlsx
 *         XlsxLite.build(sheets)       ->  Blob (para baixar no navegador)
 *   sheets = [{ name, columns: [{ header, width }], rows: [[valor | { v, s }, ...], ...] }]
 *   Estilos de célula (s): 'money' (R$), 'pct' (percentual; valor em fração, 0.25 = 25%).
 *
 * Ler:    await XlsxLite.read(arrayBuffer) -> { sheets: [{ name, rows: [[...], ...] }] }
 *         Entende planilhas feitas pelo Excel, LibreOffice, Google Planilhas e afins (.xlsx).
 *         Precisa de DOMParser e DecompressionStream (navegadores atuais).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.XlsxLite = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const enc = new TextEncoder();
  const dec = new TextDecoder('utf-8');

  // ---------------- CRC32 ----------------
  let CRC_TABLE = null;
  function crc32(bytes) {
    if (!CRC_TABLE) {
      CRC_TABLE = new Uint32Array(256);
      for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        CRC_TABLE[n] = c >>> 0;
      }
    }
    let crc = 0xffffffff;
    for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
    return (crc ^ 0xffffffff) >>> 0;
  }

  // ---------------- ZIP (sem compressão) ----------------
  function zipStore(files) {
    // files: [{ name, data: Uint8Array }]
    const now = new Date();
    const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const chunks = [];
    const central = [];
    let offset = 0;
    const push = (u8) => {
      chunks.push(u8);
      offset += u8.length;
    };
    for (const f of files) {
      const name = enc.encode(f.name);
      const crc = crc32(f.data);
      const local = new DataView(new ArrayBuffer(30));
      local.setUint32(0, 0x04034b50, true);
      local.setUint16(4, 20, true);
      local.setUint16(6, 0x0800, true); // nomes em UTF-8
      local.setUint16(8, 0, true); // sem compressão
      local.setUint16(10, dosTime, true);
      local.setUint16(12, dosDate, true);
      local.setUint32(14, crc, true);
      local.setUint32(18, f.data.length, true);
      local.setUint32(22, f.data.length, true);
      local.setUint16(26, name.length, true);
      local.setUint16(28, 0, true);
      const localOffset = offset;
      push(new Uint8Array(local.buffer));
      push(name);
      push(f.data);

      const cd = new DataView(new ArrayBuffer(46));
      cd.setUint32(0, 0x02014b50, true);
      cd.setUint16(4, 20, true);
      cd.setUint16(6, 20, true);
      cd.setUint16(8, 0x0800, true);
      cd.setUint16(10, 0, true);
      cd.setUint16(12, dosTime, true);
      cd.setUint16(14, dosDate, true);
      cd.setUint32(16, crc, true);
      cd.setUint32(20, f.data.length, true);
      cd.setUint32(24, f.data.length, true);
      cd.setUint16(28, name.length, true);
      cd.setUint16(30, 0, true);
      cd.setUint16(32, 0, true);
      cd.setUint16(34, 0, true);
      cd.setUint16(36, 0, true);
      cd.setUint32(38, 0, true);
      cd.setUint32(42, localOffset, true);
      central.push(new Uint8Array(cd.buffer), name);
    }
    const cdStart = offset;
    central.forEach(push);
    const cdSize = offset - cdStart;
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true);
    end.setUint16(8, files.length, true);
    end.setUint16(10, files.length, true);
    end.setUint32(12, cdSize, true);
    end.setUint32(16, cdStart, true);
    push(new Uint8Array(end.buffer));

    const out = new Uint8Array(offset);
    let pos = 0;
    for (const c of chunks) {
      out.set(c, pos);
      pos += c.length;
    }
    return out;
  }

  // ---------------- gerar .xlsx ----------------
  const xmlEsc = (s) =>
    String(s)
      // caracteres de controle não são permitidos em XML
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');

  function colName(i) {
    let s = '';
    i += 1;
    while (i > 0) {
      const m = (i - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      i = Math.floor((i - 1) / 26);
    }
    return s;
  }

  const STYLE_ID = { header: 1, money: 2, pct: 3 };

  function safeSheetName(name, used) {
    let n = String(name).replace(/[:\\/?*[\]]/g, ' ').trim().slice(0, 31) || 'Planilha';
    let base = n;
    let k = 2;
    while (used.has(n.toLowerCase())) {
      const suffix = ' ' + k++;
      n = base.slice(0, 31 - suffix.length) + suffix;
    }
    used.add(n.toLowerCase());
    return n;
  }

  function cellXml(ref, value, styleId) {
    const s = styleId ? ` s="${styleId}"` : '';
    if (value === null || value === undefined || value === '') return styleId ? `<c r="${ref}"${s}/>` : '';
    if (typeof value === 'number' && Number.isFinite(value)) return `<c r="${ref}"${s}><v>${value}</v></c>`;
    if (typeof value === 'boolean') return `<c r="${ref}"${s} t="b"><v>${value ? 1 : 0}</v></c>`;
    const text = String(value);
    const sp = /^\s|\s$|\n/.test(text) ? ' xml:space="preserve"' : '';
    return `<c r="${ref}"${s} t="inlineStr"><is><t${sp}>${xmlEsc(text)}</t></is></c>`;
  }

  function sheetXml(sheet) {
    const cols = sheet.columns || [];
    const rows = sheet.rows || [];
    const lastCol = Math.max(cols.length, ...rows.map((r) => r.length), 1);
    const lastRow = rows.length + 1;
    let xml =
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      `<dimension ref="A1:${colName(lastCol - 1)}${lastRow}"/>` +
      '<sheetViews><sheetView workbookViewId="0">' +
      '<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="A2" sqref="A2"/>' +
      '</sheetView></sheetViews><sheetFormatPr defaultRowHeight="15"/>';
    if (cols.length) {
      xml += '<cols>';
      cols.forEach((c, i) => {
        xml += `<col min="${i + 1}" max="${i + 1}" width="${c.width || 16}" customWidth="1"/>`;
      });
      xml += '</cols>';
    }
    xml += '<sheetData>';
    xml += '<row r="1" ht="22" customHeight="1">';
    cols.forEach((c, i) => {
      xml += cellXml(colName(i) + '1', c.header, STYLE_ID.header);
    });
    xml += '</row>';
    rows.forEach((row, r) => {
      xml += `<row r="${r + 2}">`;
      row.forEach((cell, i) => {
        let v = cell;
        let st = 0;
        if (cell && typeof cell === 'object' && 'v' in cell) {
          v = cell.v;
          st = STYLE_ID[cell.s] || 0;
        }
        xml += cellXml(colName(i) + (r + 2), v, st);
      });
      xml += '</row>';
    });
    xml += '</sheetData>';
    if (cols.length && rows.length) xml += `<autoFilter ref="A1:${colName(cols.length - 1)}${lastRow}"/>`;
    xml += '</worksheet>';
    return xml;
  }

  const STYLES_XML =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="1"><numFmt numFmtId="164" formatCode="&quot;R$&quot;\\ #,##0.00"/></numFmts>' +
    '<fonts count="2">' +
    '<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>' +
    '<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>' +
    '</fonts>' +
    '<fills count="3">' +
    '<fill><patternFill patternType="none"/></fill>' +
    '<fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FF0B6E7F"/><bgColor indexed="64"/></patternFill></fill>' +
    '</fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="4">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center"/></xf>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="10" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  function buildBytes(sheets) {
    if (!sheets || !sheets.length) throw new Error('Nenhuma planilha para gerar.');
    const used = new Set();
    const names = sheets.map((s) => safeSheetName(s.name, used));
    const files = [];
    const add = (name, text) => files.push({ name, data: enc.encode(text) });

    add(
      '[Content_Types].xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join('') +
        '</Types>'
    );
    add(
      '_rels/.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>'
    );
    add(
      'xl/workbook.xml',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
        '<bookViews><workbookView/></bookViews><sheets>' +
        names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>'
    );
    add(
      'xl/_rels/workbook.xml.rels',
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>'
    );
    add('xl/styles.xml', STYLES_XML);
    sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s)));
    return zipStore(files);
  }

  function build(sheets) {
    return new Blob([buildBytes(sheets)], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  }

  // ---------------- ler .xlsx ----------------
  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('Este navegador é antigo demais para abrir planilhas. Atualize o navegador.');
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function readZipEntries(buf) {
    const u8 = new Uint8Array(buf);
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    let eocd = -1;
    for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i--) {
      if (dv.getUint32(i, true) === 0x06054b50) {
        eocd = i;
        break;
      }
    }
    if (eocd < 0) throw new Error('not-zip');
    const total = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const entries = {};
    for (let n = 0; n < total; n++) {
      if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('not-zip');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const commentLen = dv.getUint16(p + 32, true);
      const localOffset = dv.getUint32(p + 42, true);
      const name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries[name] = { method, csize, localOffset };
      p += 46 + nameLen + extraLen + commentLen;
    }
    return { u8, dv, entries };
  }

  async function entryText(zip, name) {
    const e = zip.entries[name];
    if (!e) return null;
    const { u8, dv } = zip;
    const lo = e.localOffset;
    if (dv.getUint32(lo, true) !== 0x04034b50) throw new Error('not-zip');
    const start = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true);
    const raw = u8.subarray(start, start + e.csize);
    if (e.method === 0) return dec.decode(raw);
    if (e.method === 8) return dec.decode(await inflateRaw(raw));
    throw new Error('Formato de compressão não suportado.');
  }

  function parseXml(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('xml');
    return doc;
  }
  const byTag = (node, tag) => Array.from(node.getElementsByTagNameNS('*', tag));

  function colIndex(ref) {
    const m = /^([A-Z]+)/i.exec(ref || '');
    if (!m) return -1;
    let n = 0;
    for (const ch of m[1].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
    return n - 1;
  }

  function textOfSi(si) {
    // junta todos os <t>, ignorando fonética (rPh)
    let out = '';
    const walk = (node) => {
      for (const child of Array.from(node.childNodes)) {
        if (child.nodeType !== 1) continue;
        const ln = child.localName;
        if (ln === 'rPh') continue;
        if (ln === 't') out += child.textContent;
        else walk(child);
      }
    };
    walk(si);
    return out;
  }

  async function read(arrayBuffer) {
    let zip;
    try {
      zip = readZipEntries(arrayBuffer);
    } catch (e) {
      throw new Error('Não consegui abrir o arquivo. Use uma planilha do Excel salva como .xlsx (não .xls).');
    }
    const wbText = await entryText(zip, 'xl/workbook.xml');
    if (!wbText) throw new Error('Este arquivo não parece ser uma planilha do Excel (.xlsx).');
    const relsText = await entryText(zip, 'xl/_rels/workbook.xml.rels');
    const rels = {};
    if (relsText) {
      byTag(parseXml(relsText), 'Relationship').forEach((r) => {
        rels[r.getAttribute('Id')] = r.getAttribute('Target');
      });
    }
    const sstText = await entryText(zip, 'xl/sharedStrings.xml');
    const shared = sstText ? byTag(parseXml(sstText), 'si').map(textOfSi) : [];

    const sheetNodes = byTag(parseXml(wbText), 'sheet');
    const sheets = [];
    for (let idx = 0; idx < sheetNodes.length; idx++) {
      const node = sheetNodes[idx];
      const name = node.getAttribute('name');
      const rid = node.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || node.getAttribute('r:id');
      let target = rels[rid] || `worksheets/sheet${idx + 1}.xml`;
      target = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const text = await entryText(zip, target);
      if (!text) continue;
      const doc = parseXml(text);
      const rows = [];
      let rowCounter = 0;
      for (const rowEl of byTag(doc, 'row')) {
        const rIdx = rowEl.getAttribute('r') ? Number(rowEl.getAttribute('r')) - 1 : rowCounter;
        rowCounter = rIdx + 1;
        const cells = [];
        let colCounter = 0;
        for (const c of Array.from(rowEl.childNodes)) {
          if (c.nodeType !== 1 || c.localName !== 'c') continue;
          let ci = colIndex(c.getAttribute('r'));
          if (ci < 0) ci = colCounter;
          colCounter = ci + 1;
          const t = c.getAttribute('t');
          const vEl = byTag(c, 'v')[0];
          let val = null;
          if (t === 'inlineStr') {
            const is = byTag(c, 'is')[0];
            val = is ? textOfSi(is) : '';
          } else if (vEl) {
            const raw = vEl.textContent;
            if (t === 's') val = shared[Number(raw)] ?? '';
            else if (t === 'str' || t === 'e') val = raw;
            else if (t === 'b') val = raw === '1';
            else {
              const num = Number(raw);
              val = raw !== '' && Number.isFinite(num) ? num : raw;
            }
          }
          if (val !== null) cells[ci] = val;
        }
        for (let i = 0; i < cells.length; i++) if (cells[i] === undefined) cells[i] = null;
        rows[rIdx] = cells;
      }
      for (let i = 0; i < rows.length; i++) if (!rows[i]) rows[i] = [];
      sheets.push({ name, rows });
    }
    return { sheets };
  }

  // ---------------- CSV (alternativa simples) ----------------
  function readCsv(text) {
    text = text.replace(/^﻿/, '');
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = (firstLine.match(/;/g) || []).length >= (firstLine.match(/,/g) || []).length ? ';' : ',';
    const rows = [];
    let row = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') {
            cur += '"';
            i++;
          } else q = false;
        } else cur += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) {
        row.push(cur);
        cur = '';
      } else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cur);
        rows.push(row);
        row = [];
        cur = '';
      } else cur += ch;
    }
    if (cur !== '' || row.length) {
      row.push(cur);
      rows.push(row);
    }
    return { sheets: [{ name: 'CSV', rows: rows.map((r) => r.map((c) => (c === '' ? null : c))) }] };
  }

  return { buildBytes, build, read, readCsv, crc32 };
});
