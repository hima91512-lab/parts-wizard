"use strict";

const {
  useState,
  useRef,
  useEffect,
  useMemo,
  useCallback
} = React;
const L = LucideReact;

/* =====================================================================
   0) LOCAL STORAGE + CLAUDE API (standalone app)
   ===================================================================== */
const LS = {
  get(k, d) {
    try {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) {
      return d;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch (e) {}
  }
};
const REPO = "hima91512-lab/parts-wizard";
const blobToB64 = b => new Promise(res => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(",")[1]);
  r.readAsDataURL(b);
});
function makeSample(key) {
  if (!key) return null;
  const fn = async function (prompt) {
    let opts = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : {};
    const content = [];
    for (const b of opts.images || []) content.push({
      type: "image",
      source: {
        type: "base64",
        media_type: b.type || "image/jpeg",
        data: await blobToB64(b)
      }
    });
    content.push({
      type: "text",
      text: prompt
    });
    const model = opts.images ? "claude-haiku-5-5" : "claude-sonnet-5-5";
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": key,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify({
        model,
        max_tokens: 3000,
        messages: [{
          role: "user",
          content
        }]
      })
    });
    if (!r.ok) {
      const t = await r.text();
      const e = new Error(t);
      e.code = r.status === 429 ? "rate_limited" : r.status === 401 ? "bad_key" : "api_" + r.status;
      throw e;
    }
    const j = await r.json();
    return {
      text: (j.content || []).map(c => c.text || "").join("")
    };
  };
  fn.limits = async () => ({
    images: true
  });
  return fn;
}

/* =====================================================================
   1) BRAND REGISTRY — part-number formats, label text, domains, links
   ===================================================================== */
const g = q => "https://www.google.com/search?q=" + encodeURIComponent(q);
const BRANDS = [{
  id: "cat",
  name: "Caterpillar (CAT)",
  oem: true,
  dom: /(^|\.)cat\.com$|caterpillar/i,
  txt: /\bCAT\b|CATERP|PEORIA|D\d{2}M\d{2}Y\d{2}/,
  pn: [/\b(\d{3})-(\d{4})\b/g, /\b(\d[A-Z])-?(\d{4})\b/g],
  fmt: m => m[1] + "-" + m[2],
  links: p => [{
    t: "صفحة القطعة في parts.cat.com",
    u: "https://parts.cat.com/en/catcorp/product/" + p
  }, {
    t: "Cat Filters Cross Reference",
    u: "https://www.catfiltercrossreference.com"
  }]
}, {
  id: "komatsu",
  name: "Komatsu",
  oem: true,
  dom: /komatsu/i,
  txt: /K[O0]MA[T1I]\s?[S5]U/,
  pn: [/\b([0-9A-Z]{3})-([0-9A-Z]{2,3})-([0-9A-Z]{4,5})\b/g, /\b(0\d{4})-(\d{5})\b/g],
  fmt: m => m.slice(1).filter(Boolean).join("-"),
  links: p => [{
    t: "صفحة الفلتر في komatsu.com",
    u: "https://www.komatsu.com/en-us/products/parts/filters/" + p
  }]
}, {
  id: "cummins",
  weak: true,
  name: "Cummins",
  oem: true,
  dom: /cummins/i,
  txt: /CUMMINS/,
  pn: [/\b(\d{7})\b/g],
  fmt: m => m[1],
  links: () => [{
    t: "التحقق من أصالة Cummins",
    u: "https://www.cummins.com/genuinepartsauthentication"
  }]
}, {
  id: "fleetguard",
  name: "Fleetguard",
  oem: false,
  dom: /fleetguard|cumminsfiltration/i,
  txt: /FLEETGUARD/,
  pn: [/\b((?:LF|FF|FS|AF|HF|WF|CS|CV|UF)\d{3,5}[A-Z]{0,3})\b/g],
  fmt: m => m[1],
  links: () => [{
    t: "موقع Fleetguard",
    u: "https://www.fleetguard.com"
  }]
}, {
  id: "donaldson",
  name: "Donaldson",
  oem: false,
  dom: /donaldson/i,
  txt: /DONALDSON/,
  pn: [/\b(P\d{6})\b/g, /\b(DB[ALF]\d{4,5})\b/g],
  fmt: m => m[1],
  links: () => [{
    t: "Donaldson Cross Reference",
    u: "https://crossreference.donaldson.com"
  }]
}, {
  id: "baldwin",
  weak: true,
  name: "Baldwin",
  oem: false,
  dom: /baldwin/i,
  txt: /BALDWIN/,
  pn: [/\b((?:BF|BT|PA|PF|PT|RS|BD|BW|LL|PT)\d{2,5}(?:-[A-Z]{2,3})?)\b/g, /\b(B\d{2,4})\b/g],
  fmt: m => m[1],
  links: () => [{
    t: "موقع Baldwin",
    u: "https://www.baldwinfilters.com"
  }]
}, {
  id: "hifi",
  name: "HIFI FILTER",
  oem: false,
  dom: /hifi-filter/i,
  txt: /HIFI|HI-FI/,
  pn: [/\b((?:SH|SN|SO|SA|SC|SK|BE)\s?\d{4,6})\b/g],
  fmt: m => m[1].replace(/\s/, ""),
  links: () => [{
    t: "موقع HIFI",
    u: "https://www.hifi-filter.com"
  }]
}, {
  id: "sakura",
  weak: true,
  name: "Sakura",
  oem: false,
  dom: /sakura/i,
  txt: /SAKURA/,
  pn: [/\b((?:FC|EF|SFC|O|A|C|H|HC|TC|WC|F)-?\d{4,5}[A-Z]?)\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "mann",
  weak: true,
  name: "MANN-FILTER",
  oem: false,
  dom: /mann-filter|mann-hummel/i,
  txt: /MANN/,
  pn: [/\b((?:WK|W|C|CF|HU|CU|PU|WDK)\s?\d{3,5}(?:\/\d)?[A-Z]?)\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "wix",
  weak: true,
  name: "WIX",
  oem: false,
  dom: /wixfilters/i,
  txt: /\bWIX\b/,
  pn: [/\b(\d{5}|WA\d{5})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "volvo",
  weak: true,
  name: "Volvo CE",
  oem: true,
  dom: /volvo/i,
  txt: /VOLVO/,
  pn: [/\b(VOE\s?\d{8}|\d{8})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "perkins",
  weak: true,
  name: "Perkins",
  oem: true,
  dom: /perkins/i,
  txt: /PERKINS/,
  pn: [/\b([A-Z]{2,4}\d{3,6})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "hitachi",
  weak: true,
  name: "Hitachi",
  oem: true,
  dom: /hitachi/i,
  txt: /HITACHI/,
  pn: [/\b(\d{7})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "jcb",
  weak: true,
  name: "JCB",
  oem: true,
  dom: /jcb/i,
  txt: /\bJCB\b/,
  pn: [/\b(\d{3}\/[A-Z0-9]{4,6})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "doosan",
  weak: true,
  name: "Doosan / Develon",
  oem: true,
  dom: /doosan|develon/i,
  txt: /DOOSAN|DEVELON/,
  pn: [/\b(\d{2,3}\.\d{5}-\d{4})\b/g, /\b(4\d{7})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "wabco",
  weak: true,
  name: "WABCO (ZF)",
  oem: true,
  dom: /wabco|zf\.com/i,
  txt: /WABCO/,
  pn: [/\b(\d{3}\s?\d{3}\s?\d{3}\s?\d)\b/g],
  fmt: m => m[1].replace(/\s/g, ""),
  links: () => [{
    t: "التحقق من أصالة WABCO",
    u: "https://www.wabco-auto.com/WABCOoriginal"
  }]
}, {
  id: "knorr",
  weak: true,
  name: "Knorr-Bremse",
  oem: true,
  dom: /knorr/i,
  txt: /KNORR/,
  pn: [/\b([A-Z]{1,3}\d{5,6}[A-Z]?)\b/g, /\b(II\d{5})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "bosch",
  weak: true,
  name: "Bosch",
  oem: false,
  dom: /bosch/i,
  txt: /BOSCH/,
  pn: [/\b(\d\s?\d{3}\s?\d{3}\s?\d{3})\b/g],
  fmt: m => m[1].replace(/\s/g, ""),
  links: () => []
}, {
  id: "zf",
  weak: true,
  name: "ZF",
  oem: true,
  dom: /zf\.com/i,
  txt: /\bZF\b/,
  pn: [/\b(\d{4}\s?\d{3}\s?\d{3})\b/g],
  fmt: m => m[1].replace(/\s/g, ""),
  links: () => []
}, {
  id: "mercedes",
  weak: true,
  name: "Mercedes-Benz",
  oem: true,
  dom: /mercedes|daimler/i,
  txt: /MERCEDES|DAIMLER/,
  pn: [/\b(A\s?\d{3}\s?\d{3}\s?\d{2}\s?\d{2})\b/g],
  fmt: m => m[1].replace(/\s/g, ""),
  links: () => []
}, {
  id: "man",
  weak: true,
  name: "MAN",
  oem: true,
  dom: /man-es|mantruck/i,
  txt: /\bMAN\b/,
  pn: [/\b(\d{2}\.\d{5}-\d{4})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "scania",
  weak: true,
  name: "Scania",
  oem: true,
  dom: /scania/i,
  txt: /SCANIA/,
  pn: [/\b(\d{7})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "daf",
  weak: true,
  name: "DAF / PACCAR",
  oem: true,
  dom: /daf|paccar/i,
  txt: /\bDAF\b|PACCAR/,
  pn: [/\b(\d{7})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "isuzu",
  weak: true,
  name: "Isuzu",
  oem: true,
  dom: /isuzu/i,
  txt: /ISUZU/,
  pn: [/\b([18]-?\d{5}-?\d{3}-?\d)\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "mitsubishi",
  weak: true,
  name: "Mitsubishi Fuso",
  oem: true,
  dom: /mitsubishi|fuso/i,
  txt: /MITSUBISHI|FUSO/,
  pn: [/\b(M[EKH]\d{6})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "toyota",
  weak: true,
  name: "Toyota",
  oem: true,
  dom: /toyota/i,
  txt: /TOYOTA/,
  pn: [/\b(\d{5}-[0-9A-Z]{5})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "deere",
  weak: true,
  name: "John Deere",
  oem: true,
  dom: /deere/i,
  txt: /DEERE/,
  pn: [/\b((?:RE|AT|AH|AR|AL|DZ|SJ)\d{5,6})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "kubota",
  weak: true,
  name: "Kubota",
  oem: true,
  dom: /kubota/i,
  txt: /KUBOTA/,
  pn: [/\b([0-9A-Z]{5}-\d{5})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "hyundai",
  weak: true,
  name: "Hyundai CE",
  oem: true,
  dom: /hyundai/i,
  txt: /HYUNDAI/,
  pn: [/\b(\d{2}[A-Z]\d-\d{5})\b/g, /\b(\d{2}[A-Z]{2}\d{5})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "skf",
  weak: true,
  name: "SKF",
  oem: false,
  dom: /skf/i,
  txt: /\bSKF\b/,
  pn: [/\b(\d{4,6}[-\s]?(?:2RS|2Z|ZZ|C3|E)?[A-Z0-9/]*)\b/g],
  fmt: m => m[1],
  links: () => [{
    t: "التحقق من أصالة SKF",
    u: "https://www.skf.com/group/products/bearings-units-housings/genuine"
  }]
}, {
  id: "timken",
  weak: true,
  name: "Timken",
  oem: false,
  dom: /timken/i,
  txt: /TIMKEN/,
  pn: [/\b(\d{3,6}\/?\d{0,5}[A-Z]?)\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "parker",
  weak: true,
  name: "Parker",
  oem: false,
  dom: /parker/i,
  txt: /PARKER/,
  pn: [/\b([0-9A-Z]{2,4}-[0-9A-Z]{2,6}(?:-[0-9A-Z]{1,6})?)\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "gates",
  weak: true,
  name: "Gates",
  oem: false,
  dom: /gates/i,
  txt: /GATES/,
  pn: [/\b(\d{4,5}[A-Z]{0,3})\b/g],
  fmt: m => m[1],
  links: () => []
}, {
  id: "denso",
  weak: true,
  name: "Denso",
  oem: false,
  dom: /denso/i,
  txt: /DENSO/,
  pn: [/\b(\d{6}-\d{4})\b/g],
  fmt: m => m[1],
  links: () => []
}];
const brandById = id => BRANDS.find(b => b.id === id);
const keyOf = pn => (pn || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const genericLinks = pn => [{
  t: "بحث Cross Reference على Google",
  u: g(pn + " cross reference")
}, {
  t: "بحث المعدات اللي بتستخدمها القطعة",
  u: g(pn + " fits models applications")
}];

/* =====================================================================
   2) CODE PAYLOAD PARSING — URL, GS1, GS1 Digital Link, key:value text
   ===================================================================== */
const GS1 = {
  "00": {
    n: "SSCC (رقم الشحنة)",
    l: 18
  },
  "01": {
    n: "GTIN (رقم المنتج العالمي)",
    l: 14
  },
  "02": {
    n: "GTIN المحتوى",
    l: 14
  },
  "10": {
    n: "رقم اللوط / الدفعة"
  },
  "11": {
    n: "تاريخ الإنتاج",
    l: 6,
    d: 1
  },
  "13": {
    n: "تاريخ التعبئة",
    l: 6,
    d: 1
  },
  "15": {
    n: "أفضل استخدام قبل",
    l: 6,
    d: 1
  },
  "16": {
    n: "تاريخ البيع حتى",
    l: 6,
    d: 1
  },
  "17": {
    n: "تاريخ الانتهاء",
    l: 6,
    d: 1
  },
  "20": {
    n: "متغيّر المنتج",
    l: 2
  },
  "21": {
    n: "الرقم التسلسلي (S/N)"
  },
  "22": {
    n: "معرّف ثانوي"
  },
  "240": {
    n: "رقم القطعة (معرّف إضافي)",
    pn: 1
  },
  "241": {
    n: "رقم قطعة العميل",
    pn: 1
  },
  "250": {
    n: "سيريال ثانوي"
  },
  "30": {
    n: "الكمية"
  },
  "37": {
    n: "عدد الوحدات"
  },
  "400": {
    n: "رقم أمر الشراء"
  },
  "422": {
    n: "بلد المنشأ (كود)",
    l: 3
  },
  "7003": {
    n: "تاريخ الصلاحية والوقت",
    l: 10
  },
  "8004": {
    n: "GIAI (رقم الأصل)"
  },
  "91": {
    n: "بيانات داخلية للشركة"
  },
  "92": {
    n: "بيانات داخلية"
  },
  "93": {
    n: "بيانات داخلية"
  },
  "94": {
    n: "بيانات داخلية"
  },
  "95": {
    n: "بيانات داخلية"
  },
  "96": {
    n: "بيانات داخلية"
  },
  "97": {
    n: "بيانات داخلية"
  },
  "98": {
    n: "بيانات داخلية"
  },
  "99": {
    n: "بيانات داخلية"
  }
};
const AR_M = ["يناير", "فبراير", "مارس", "أبريل", "مايو", "يونيو", "يوليو", "أغسطس", "سبتمبر", "أكتوبر", "نوفمبر", "ديسمبر"];
const gsDate = s => {
  const y = 2000 + +s.slice(0, 2),
    m = +s.slice(2, 4),
    d = +s.slice(4, 6);
  return m >= 1 && m <= 12 ? `${d ? d + " " : ""}${AR_M[m - 1]} ${y}` : s;
};
function parseGS1(raw) {
  let s = raw.replace(/^\][A-Za-z]\d/, "");
  const GS = "\u001d";
  const out = [];
  let i = 0,
    guard = 0;
  while (i < s.length && guard++ < 40) {
    if (s[i] === GS) {
      i++;
      continue;
    }
    let ai = null;
    for (const len of [4, 3, 2]) {
      const c = s.substr(i, len);
      if (GS1[c]) {
        ai = c;
        break;
      }
    }
    if (!ai) return out.length ? out : null;
    const def = GS1[ai];
    i += ai.length;
    let v;
    if (def.l) {
      v = s.substr(i, def.l);
      i += def.l;
    } else {
      const e = s.indexOf(GS, i);
      v = e < 0 ? s.slice(i) : s.slice(i, e);
      i = e < 0 ? s.length : e + 1;
    }
    out.push({
      ai,
      label: def.n,
      value: def.d ? gsDate(v) + ` (${v})` : v,
      rawv: v,
      pn: !!def.pn
    });
  }
  return out.length ? out : null;
}
function parsePayload(raw, format) {
  const res = {
    raw,
    format,
    kind: "text",
    fields: [],
    brand: null,
    pns: [],
    note: ""
  };
  const t = raw.trim();
  // URL
  if (/^https?:\/\//i.test(t) || /^www\./i.test(t)) {
    res.kind = "url";
    try {
      const u = new URL(/^www\./i.test(t) ? "https://" + t : t);
      res.fields.push({
        label: "الموقع",
        value: u.hostname
      });
      const b = BRANDS.find(b => b.dom.test(u.hostname));
      if (b) {
        res.brand = b.id;
        res.fields.push({
          label: "الجهة المصدرة",
          value: b.name
        });
      }
      // GS1 Digital Link /01/xxxxx/10/yyy
      const seg = u.pathname.split("/").filter(Boolean);
      const dl = [];
      for (let k = 0; k < seg.length - 1; k++) if (GS1[seg[k]] && /^[\w.-]+$/.test(seg[k + 1])) {
        dl.push({
          ai: seg[k],
          label: GS1[seg[k]].n,
          value: decodeURIComponent(seg[k + 1]),
          pn: !!GS1[seg[k]].pn
        });
        k++;
      }
      if (dl.length >= 1 && dl.some(d => d.ai === "01")) {
        res.kind = "gs1";
        res.fields.push(...dl);
      }
      for (const [k, v] of u.searchParams) {
        res.fields.push({
          label: k,
          value: v
        });
        if (/^(pn|part|partno|partnumber|p|sku|item|mpn)$/i.test(k)) res.pns.push({
          pn: v,
          brand: res.brand,
          src: "code"
        });
      }
      for (const sgm of seg) for (const b of BRANDS) for (const re of b.pn) {
        re.lastIndex = 0;
        const m = re.exec(sgm.toUpperCase());
        if (m && (!res.brand || res.brand === b.id)) res.pns.push({
          pn: b.fmt(m),
          brand: b.id,
          src: "code"
        });
      }
      if (res.brand === "cat" && /parts-packaging/.test(u.pathname)) res.note = "ده QR عام بتاع تغليف CAT: كل الملصقات عليها نفس اللينك، ومفيهوش رقم القطعة ولا سيريال. رقم القطعة بيتاخد من نص الملصق.";
    } catch (e) {}
    return res;
  }
  // CAT packaging barcode: CAT + label rev + origin + level + part number  (e.g. CATAAMX--4798991)
  const cm = t.toUpperCase().match(/^CAT([A-Z0-9]{2})([A-Z]{2})(.{2})(\d{7}|\d[A-Z]\d{4})$/);
  if (cm) {
    const p = /^\d{7}$/.test(cm[4]) ? cm[4].slice(0, 3) + "-" + cm[4].slice(3) : cm[4].slice(0, 2) + "-" + cm[4].slice(2);
    res.kind = "cat";
    res.brand = "cat";
    res.fields.push({
      label: "الشركة",
      value: "Caterpillar"
    }, {
      label: "رقم القطعة",
      value: p
    }, {
      label: "بلد المنشأ",
      value: cm[2]
    }, {
      label: "كود الملصق",
      value: cm[1]
    }, {
      label: "Level",
      value: cm[3]
    });
    res.pns.push({
      pn: p,
      brand: "cat",
      src: "code",
      strong: true
    });
    return res;
  }
  // GS1 element string
  if (/^(\][A-Za-z]\d)?(01\d{14}|00\d{18}|\u001d?(10|21|240)\S)/.test(t) || t.includes("\u001d")) {
    const f = parseGS1(t);
    if (f) {
      res.kind = "gs1";
      res.fields = f;
      f.filter(x => x.pn).forEach(x => res.pns.push({
        pn: x.rawv || x.value,
        brand: null,
        src: "code"
      }));
    }
  }
  // key:value
  if (res.kind === "text") {
    const parts = t.split(/[\n;|]+/);
    for (const p of parts) {
      const m = p.match(/^\s*([A-Za-z#./ ]{1,14})\s*[:=]\s*(.+)$/);
      if (m) {
        res.fields.push({
          label: m[1].trim(),
          value: m[2].trim()
        });
        if (/^(P\/?N|PART|PART ?NO|MPN|ITEM)/i.test(m[1].trim())) res.pns.push({
          pn: m[2].trim(),
          brand: null,
          src: "code"
        });
      }
    }
    const b = BRANDS.find(b => b.txt.test(t.toUpperCase()));
    if (b) res.brand = b.id;
  }
  res.pns.push(...extractPNs(t, res.brand, "code"));
  return res;
}
function extractPNs(text, brandHint, src) {
  const T = (text || "").toUpperCase();
  const found = [];
  const ctx = BRANDS.filter(b => b.txt.test(T)).map(b => b.id);
  for (const b of BRANDS) {
    const strong = b.id === brandHint || ctx.includes(b.id);
    // generic 7/8-digit and short patterns only count when the brand is on the label
    for (const re of b.pn) {
      re.lastIndex = 0;
      let m;
      while (m = re.exec(T)) {
        if (b.weak && !strong) continue;
        found.push({
          pn: b.fmt(m),
          brand: b.id,
          src,
          strong
        });
      }
    }
  }
  return found;
}

/* label description → Arabic part type (CAT / Komatsu style abbreviations) */
const DESC_WORDS = [[/ELEMENT/, "عنصر"], [/FILTER|FLTR/, "فلتر"], [/BREATHER/, "تنفيس"], [/STRAINER/, "مصفاة"], [/SEPARATOR|SEP\b/, "فاصل"], [/\bAS\b/, "تجميعة"], [/OIL|LUBE/, "زيت"], [/FUEL/, "ديزل"], [/WATER/, "مياه"], [/HYD|HYDRAULIC/, "هيدروليك"], [/TRANS/, "ناقل الحركة"], [/CAB/, "كابينة"], [/AIR|-\s?A\b|AS\s?-\s?A\b/, "هوا"], [/SEC|SECONDARY|INNER/, "ثانوي (داخلي)"], [/PRI|PRIMARY|OUTER/, "أساسي (خارجي)"], [/COOLANT/, "مياه تبريد"]];
function labelDesc(text) {
  const lines = (text || "").toUpperCase().split("\n");
  const line = lines.find(l => /(FILTER|ELEMENT|BREATHER|STRAINER|SEPARATOR)/.test(l));
  if (!line) return null;
  const m = line.match(/(FILTER|ELEMENT|BREATHER|STRAINER|SEPARATOR)[A-Z\s\-–—]{0,22}/);
  const raw = m[0].replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
  const ar = [];
  DESC_WORDS.forEach(_ref => {
    let [re, w] = _ref;
    if (re.test(raw) && !ar.includes(w)) ar.push(w);
  });
  return {
    raw,
    ar: ar.join(" ")
  };
}

/* label production date (CAT D..M..Y) */
function labelDate(text) {
  const m = (text || "").toUpperCase().match(/[DPO0]\s?([0-9OQ]{2})\s?M\s?([0-9OQ]{2})\s?Y\s?([0-9OQ]{2})/);
  if (!m) {
    const p = (text || "").match(/\b(\d{2})[.\/-](\d{2})[.\/-](20\d{2}|\d{2})\b/);
    if (p) {
      const d = +p[1],
        mo = +p[2],
        y = p[3].length === 2 ? 2000 + +p[3] : +p[3];
      if (mo >= 1 && mo <= 12 && d >= 1 && d <= 31 && y <= new Date().getFullYear()) return {
        text: `${d} ${AR_M[mo - 1]} ${y}`,
        code: p[0]
      };
    }
    return null;
  }
  const f = s => +s.replace(/[OQ]/g, "0");
  const d = f(m[1]),
    mo = f(m[2]),
    y = 2000 + f(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return {
    text: `${d} ${AR_M[mo - 1]} ${y}`,
    code: `D${m[1]}M${m[2]}Y${m[3]}`
  };
}

/* =====================================================================
   3) IMAGE DECODING — BarcodeDetector → ZXing → jsQR, + OCR
   ===================================================================== */
function loadImage(file) {
  return new Promise((res, rej) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = rej;
    im.src = URL.createObjectURL(file);
  });
}
function toCanvas(img) {
  let sc = arguments.length > 1 && arguments[1] !== undefined ? arguments[1] : 1;
  let crop = arguments.length > 2 ? arguments[2] : undefined;
  const [sx, sy, sw, sh] = crop || [0, 0, img.naturalWidth, img.naturalHeight];
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(sw * sc));
  c.height = Math.max(1, Math.round(sh * sc));
  c.getContext("2d", {
    willReadFrequently: true
  }).drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
  return c;
}
const FMT_NAMES = {
  qr_code: "QR",
  data_matrix: "DataMatrix",
  aztec: "Aztec",
  pdf417: "PDF417",
  code_128: "Code128",
  code_39: "Code39",
  ean_13: "EAN-13",
  upc_a: "UPC-A",
  itf: "ITF",
  ean_8: "EAN-8",
  code_93: "Code93",
  codabar: "Codabar",
  upc_e: "UPC-E"
};
function find2D(img) {
  const W = img.naturalWidth,
    H = img.naturalHeight,
    sc = 900 / Math.max(W, H);
  const c = toCanvas(img, sc),
    w = c.width,
    h = c.height,
    d = c.getContext("2d").getImageData(0, 0, w, h).data,
    g = new Float32Array(w * h);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) g[j] = d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8;
  const CS = 6,
    cw = Math.floor(w / CS),
    ch = Math.floor(h / CS),
    mx = new Float32Array(cw * ch),
    my = new Float32Array(cw * ch);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x,
      cx = Math.min(cw - 1, x / CS | 0),
      cy = Math.min(ch - 1, y / CS | 0);
    if (Math.abs(g[i + 1] - g[i - 1]) > 40) mx[cy * cw + cx]++;
    if (Math.abs(g[i + w] - g[i - w]) > 40) my[cy * cw + cx]++;
  }
  const on = new Uint8Array(cw * ch);
  for (let i = 0; i < on.length; i++) on[i] = mx[i] > CS * CS * 0.12 && my[i] > CS * CS * 0.12 ? 1 : 0;
  const seen = new Uint8Array(cw * ch),
    out = [];
  for (let i = 0; i < on.length; i++) {
    if (!on[i] || seen[i]) continue;
    const st = [i];
    seen[i] = 1;
    let x0 = 1e9,
      y0 = 1e9,
      x1 = -1,
      y1 = -1,
      n = 0;
    while (st.length) {
      const k = st.pop(),
        kx = k % cw,
        ky = k / cw | 0;
      n++;
      x0 = Math.min(x0, kx);
      x1 = Math.max(x1, kx);
      y0 = Math.min(y0, ky);
      y1 = Math.max(y1, ky);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = kx + dx,
          ny = ky + dy;
        if (nx < 0 || ny < 0 || nx >= cw || ny >= ch) continue;
        const q = ny * cw + nx;
        if (on[q] && !seen[q]) {
          seen[q] = 1;
          st.push(q);
        }
      }
    }
    const bw = x1 - x0 + 1,
      bh = y1 - y0 + 1;
    if (n >= 4 && bw / bh > 0.4 && bw / bh < 2.5 && n / (bw * bh) > 0.45 && bw * bh < cw * ch * 0.25) out.push([x0 * CS / sc, y0 * CS / sc, bw * CS / sc, bh * CS / sc, n]);
  }
  return out.sort((a, b) => b[4] - a[4]);
}
async function decodeCodes(img, label) {
  const found = new Map();
  const add = (text, fmt) => {
    if (text && !found.has(text)) found.set(text, fmt);
  };
  // a) native BarcodeDetector (Android Chrome, Safari 17+)
  try {
    if ("BarcodeDetector" in window) {
      const fm = await BarcodeDetector.getSupportedFormats();
      const det = new BarcodeDetector({
        formats: fm
      });
      const r = await det.detect(img);
      r.forEach(x => add(x.rawValue, FMT_NAMES[x.format] || x.format));
    }
  } catch (e) {}
  // b) ZXing multi-format on whole image + tiles
  try {
    const Z = window.ZXing;
    const hints = new Map();
    hints.set(Z.DecodeHintType.TRY_HARDER, true);
    hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.AZTEC, Z.BarcodeFormat.PDF_417, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.ITF]);
    const reader = new Z.MultiFormatReader();
    reader.setHints(hints);
    const W = img.naturalWidth,
      H = img.naturalHeight;
    const jobs = [];
    if (label) {
      jobs.push([1, label, "label"]);
      jobs.push([1, [label[0], label[1] + label[3] * 0.55, label[2], label[3] * 0.45], "label"]);
    }
    jobs.push([1, null], [0.6, null], [0.4, null]);
    for (const [cx, cy] of [[0, 0], [0.5, 0], [0, 0.5], [0.5, 0.5], [0.25, 0.25]]) jobs.push([1, [cx * W, cy * H, W / 2, H / 2]]);
    for (let k = 0; k < 6; k++) jobs.push([1, [0, k * H / 8, W, H / 4], "strip"]);
    const gotPN = () => [...found.keys()].some(t => parsePayload(t, "").pns.length > 0);
    for (const [sc, crop, kind] of jobs) {
      if (kind !== "label" && gotPN()) break;
      if (kind === "strip" && [...found.values()].some(f => /128|39|EAN|UPC|ITF/i.test(String(Z.BarcodeFormat[f] || f)))) break;
      const c = toCanvas(img, kind === "label" ? Math.min(2, 1600 / crop[2]) : kind === "strip" ? 1 : Math.min(sc, 1800 / Math.max(W, H) * (crop ? 2 : 1)), crop);
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      const lum = new Uint8ClampedArray(c.width * c.height);
      for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8;
      try {
        const r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height))), hints);
        add(r.getText(), Z.BarcodeFormat[r.getBarcodeFormat()]);
      } catch (e) {}
    }
    // small 2D codes (DataMatrix / QR): locate dense 2-D texture blobs, then decode each one upscaled
    const dmR = new Z.DataMatrixReader(),
      qrR = new Z.QRCodeReader();
    // always look for 2-D codes (QR / DataMatrix) — even when a barcode already gave the part number
    for (const [bx, by, bw, bh] of find2D(img).slice(0, 40)) {
      const p = Math.max(bw, bh) * 0.3,
        sx = Math.max(0, bx - p),
        sy = Math.max(0, by - p),
        cw = Math.min(W - sx, bw + 2 * p),
        chh = Math.min(H - sy, bh + 2 * p);
      for (const tgt of [300, 500]) {
        const c = toCanvas(img, tgt / Math.max(cw, chh), [sx, sy, cw, chh]);
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data,
          lum = new Uint8ClampedArray(c.width * c.height);
        for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8;
        let hit = false;
        for (const [rd, f] of [[dmR, "DATA_MATRIX"], [qrR, "QR_CODE"]]) {
          try {
            const r = rd.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height))), hints);
            add(r.getText(), f);
            hit = true;
          } catch (e) {}
        }
        if (!hit && typeof jsQR === "function") {
          const q = jsQR(d, c.width, c.height);
          if (q && q.data) {
            add(q.data, "QR_CODE");
            hit = true;
          }
        }
        if (hit) break;
      }
    }
  } catch (e) {
    console.warn(e);
  }
  // c) jsQR fallback for QR
  if (typeof jsQR === "function" && ![...found.values()].some(f => /QR/i.test(f))) {
    const M = Math.max(img.naturalWidth, img.naturalHeight);
    for (const sc of [Math.min(1, 1600 / M), Math.min(0.6, 1000 / M), Math.min(0.4, 700 / M)]) {
      const c = toCanvas(img, sc);
      const r = jsQR(c.getContext("2d").getImageData(0, 0, c.width, c.height).data, c.width, c.height);
      if (r && r.data) {
        add(r.data, "QR_CODE");
        break;
      }
    }
  }
  return [...found.entries()].map(_ref2 => {
    let [text, fmt] = _ref2;
    return {
      text,
      fmt: String(fmt).replace("_CODE", "").replace("_", " ")
    };
  });
}

/* find the CAT-yellow label area so codes & text are read at full resolution */
function findLabel(img) {
  const W = img.naturalWidth,
    H = img.naturalHeight,
    sc = 320 / Math.max(W, H);
  const c = toCanvas(img, sc),
    w = c.width,
    h = c.height,
    d = c.getContext("2d").getImageData(0, 0, w, h).data;
  const cols = new Array(w).fill(0),
    rows = new Array(h).fill(0);
  let n = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4,
      r = d[i],
      g = d[i + 1],
      b = d[i + 2];
    if (r > 170 && g > 120 && b < 120 && r - b > 90 && Math.abs(r - g) < 90) {
      cols[x]++;
      rows[y]++;
      n++;
    }
  }
  if (n < w * h * 0.015) return null;
  const span = (arr, len) => {
    const th = Math.max(2, Math.max(...arr) * 0.25);
    let a = 0,
      b = len - 1;
    while (a < len && arr[a] < th) a++;
    while (b > 0 && arr[b] < th) b--;
    return [a, b];
  };
  let [x0, x1] = span(cols, w),
    [y0, y1] = span(rows, h);
  if (x1 <= x0 || y1 <= y0) return null;
  const mx = (x1 - x0) * 0.08,
    my = (y1 - y0) * 0.35; // labels have a white band under the yellow part (barcode)
  x0 = Math.max(0, x0 - mx);
  x1 = Math.min(w, x1 + mx);
  y0 = Math.max(0, y0 - my * 0.3);
  y1 = Math.min(h, y1 + my);
  if ((x1 - x0) * (y1 - y0) > w * h * 0.9) return null;
  return [x0 / sc, y0 / sc, (x1 - x0) / sc, (y1 - y0) / sc];
}
const base = p => new URL(p, document.baseURI).href;
let ocrWorker = null,
  ocrProgress = () => {};
function getOCR() {
  if (!ocrWorker) ocrWorker = fetch(base("lib/lang/eng-traineddata.wasm")).then(r => r.arrayBuffer()).then(buf => Tesseract.createWorker([{
    code: "eng",
    data: new Uint8Array(buf)
  }], 1, {
    workerPath: base("lib/worker.min.js"),
    corePath: base("lib/core/"),
    workerBlobURL: false,
    cacheMethod: "none",
    logger: m => ocrProgress(m)
  })).catch(e => {
    ocrWorker = null;
    throw e;
  });
  return ocrWorker;
}
async function runOCR(img, label) {
  const w = await getOCR();
  await w.setParameters({
    tessedit_pageseg_mode: "11"
  });
  const W = img.naturalWidth,
    H = img.naturalHeight;
  const c = label ? toCanvas(img, Math.min(2.5, 1800 / label[2]), label) : toCanvas(img, Math.min(1, 2200 / Math.max(W, H)));
  const x = c.getContext("2d");
  const id = x.getImageData(0, 0, c.width, c.height),
    p = id.data;
  for (let i = 0; i < p.length; i += 4) {
    let v = 0.3 * p[i] + 0.59 * p[i + 1] + 0.11 * p[i + 2];
    v = Math.max(0, Math.min(255, (v - 128) * 1.6 + 128));
    p[i] = p[i + 1] = p[i + 2] = v;
  }
  x.putImageData(id, 0, 0);
  const {
    data
  } = await w.recognize(c);
  return (data.text || "").split("\n").map(s => s.trim()).filter(s => s.length > 2).join("\n");
}

/* Claude vision: read the label like a human inspector */
async function visionRead(sample, img, label) {
  const crop = label || [0, 0, img.naturalWidth, img.naturalHeight];
  const c = toCanvas(img, Math.min(1, 1600 / Math.max(crop[2], crop[3])), crop);
  const blob = await new Promise(r => c.toBlob(r, "image/jpeg", 0.85));
  const prompt = `دي صورة ملصق أو جسم قطعة غيار معدات ثقيلة. اقرا كل المكتوب عليها بدقة.
رجّع JSON فقط:
{"brand":"اسم الشركة على الملصق","partNumber":"رقم القطعة الرئيسي بالظبط زي ما مكتوب (بالشُرَط)","description":"وصف القطعة المكتوب على الملصق بالإنجليزي",
"typeAr":"نوع القطعة بالعربي","origin":"بلد المنشأ","quantity":"الكمية","dateCode":"أي كود تاريخ/لوط أو تاريخ مطبوع زي D03M02Y26 أو 227011E أو 28.08.24","serial":"الرقم التسلسلي لو موجود (S/N أو (21))","otherNumbers":["أي أرقام قطع تانية"],"text":"كل النص المقروء سطر بسطر"}
لو مش واضح حاجة اكتبها "" — ممنوع التخمين.`;
  const r = await sample(prompt, {
    images: [blob],
    modelTier: "default"
  });
  const t = r.text || "";
  return JSON.parse(t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1));
}

/* =====================================================================
   4) AI LOOKUP (Claude via `sample`) — clearly marked as unverified
   ===================================================================== */
const AI_SCHEMA = `{
 "partNumber": "رقم القطعة بالصيغة الرسمية",
 "manufacturer": "الشركة صاحبة الرقم",
 "isOEM": true,
 "category": "Filter | Engine | Hydraulic | Undercarriage | Electrical | GET | Seal | Bearing | Other",
 "typeEn": "e.g. Engine Oil Filter",
 "typeAr": "اسم القطعة بالعربي",
 "description": "وصف فني مختصر بالعربي (سطرين)",
 "specs": [{"k":"Height","v":"..."}],
 "supersession": {"replaces": ["أرقام قديمة"], "replacedBy": ["رقم أحدث إن وجد"]},
 "oemAlternates": [{"brand":"Caterpillar","pn":"...","note":""}],
 "equipment": [{"brand":"Caterpillar","type":"Wheel Loader","models":["950H","962H"],"engine":"C7","confidence":"medium"}],
 "aftermarket": [{"brand":"Donaldson","pn":"P551808","confidence":"high|medium|low"}],
 "notes": "تحذيرات مهمة: اختلاف مقاسات/إصدارات/سيريال"
}`;
async function aiLookup(sample, pn, ctx) {
  const prompt = `أنت مهندس قطع غيار معدات ثقيلة خبير في الـ Cross Reference.
رقم القطعة: ${pn}
${ctx.brand ? "الماركة المرجّحة: " + ctx.brand : ""}
${ctx.desc ? "وصف القطعة على الملصق: " + ctx.desc : ""}
${ctx.label ? "نص الملصق (OCR):\n" + ctx.label.slice(0, 600) : ""}
${ctx.codes ? "محتوى الأكواد: " + ctx.codes.slice(0, 400) : ""}

المطلوب: تعريف القطعة وكل الأرقام البديلة.
قواعد صارمة:
- أرقام القطع البديلة: اكتب فقط اللي انت متأكد منه فعلاً، وممنوع تأليف أرقام.
- المعدات: اكتب الموديلات اللي تعرفها حتى لو ثقتك متوسطة، وحدد confidence لكل مجموعة (high/medium/low). ماتسيبش المعدات فاضية لو تعرف عائلة المحركات أو الموديلات المرجّحة.
- النوع: لو الملصق بيقول ELEMENT أو FILTER بس، استنتج النوع (هوا/زيت/ديزل/هيدروليك) من معرفتك بالرقم.
- confidence: high = رقم مشهور ومتطابق في كتالوجات متعددة، medium = غالباً صحيح، low = محتمل.
- غطّي لو تعرف: Donaldson, Fleetguard, Baldwin, WIX, MANN-FILTER, HIFI, Sakura, Hengst, Luber-finer.
- المعدات: اكتب كل الموديلات والمحركات اللي تعرفها، مقسّمة حسب نوع المعدة (Wheel Loader / Excavator / Motor Grader ...) في الحقل type، زي ما كتالوج الشركة بيعرضها.
- النصوص الوصفية بالعربي، والأرقام والموديلات بالإنجليزي.
رجّع JSON فقط بالشكل ده:
${AI_SCHEMA}`;
  const r = await sample(prompt, {
    modelTier: "complex"
  });
  const t = r.text || "";
  const j = t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1);
  return JSON.parse(j);
}

/* =====================================================================
   5) UI
   ===================================================================== */
function db0Test(d, id) {
  if (id) d.collection("data/users/" + id);
}
const Icon = _ref3 => {
  let {
    n,
    ...p
  } = _ref3;
  const C = L[n] || L.Circle;
  return /*#__PURE__*/React.createElement(C, p);
};
const Badge = _ref4 => {
  let {
    kind,
    children
  } = _ref4;
  return /*#__PURE__*/React.createElement("span", {
    className: "badge " + kind
  }, children);
};
const confAr = {
  high: "ثقة عالية",
  medium: "ثقة متوسطة",
  low: "ثقة منخفضة"
};
function Section(_ref5) {
  let {
    icon,
    title,
    right,
    children
  } = _ref5;
  return /*#__PURE__*/React.createElement("section", {
    className: "sec"
  }, /*#__PURE__*/React.createElement("header", null, /*#__PURE__*/React.createElement(Icon, {
    n: icon,
    size: 18
  }), /*#__PURE__*/React.createElement("h3", null, title), right), children);
}
function CodeCard(_ref6) {
  let {
    c
  } = _ref6;
  const [open, setOpen] = useState(false);
  return /*#__PURE__*/React.createElement("div", {
    className: "code"
  }, /*#__PURE__*/React.createElement("div", {
    className: "code-h"
  }, /*#__PURE__*/React.createElement(Badge, {
    kind: "fmt"
  }, c.fmt), /*#__PURE__*/React.createElement(Badge, {
    kind: c.p.kind
  }, c.p.kind === "url" ? "لينك" : c.p.kind === "gs1" ? "GS1" : c.p.kind === "cat" ? "باركود CAT" : "نص"), c.p.brand && /*#__PURE__*/React.createElement(Badge, {
    kind: "brand"
  }, brandById(c.p.brand).name), /*#__PURE__*/React.createElement("button", {
    className: "mini",
    onClick: () => setOpen(!open)
  }, open ? "إخفاء" : "المحتوى الخام")), c.p.fields.length > 0 && /*#__PURE__*/React.createElement("table", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("tbody", null, c.p.fields.map((f, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, f.label, f.ai ? /*#__PURE__*/React.createElement("small", {
    dir: "ltr"
  }, " (", f.ai, ")") : null), /*#__PURE__*/React.createElement("td", {
    dir: "ltr"
  }, f.value))))), c.p.note && /*#__PURE__*/React.createElement("p", {
    className: "note"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Info",
    size: 14
  }), " ", c.p.note), open && /*#__PURE__*/React.createElement("pre", {
    dir: "ltr"
  }, c.text.replace(/\u001d/g, "<GS>")));
}
function PartView(_ref7) {
  var _rec$sources;
  let {
    pn,
    brandHint,
    rec,
    ai,
    aiState,
    onAI,
    onRequest,
    reqState,
    ocrText,
    codesText,
    date,
    desc
  } = _ref7;
  const b = brandById((rec === null || rec === void 0 ? void 0 : rec.brand) || brandHint || (ai === null || ai === void 0 ? void 0 : ai.brandId));
  const links = [...(b ? b.links((rec === null || rec === void 0 ? void 0 : rec.pn) || pn) : []), ...genericLinks((rec === null || rec === void 0 ? void 0 : rec.pn) || pn)];
  const src = rec ? "verified" : ai ? "ai" : "none";
  const type = (rec === null || rec === void 0 ? void 0 : rec.typeAr) || (ai === null || ai === void 0 ? void 0 : ai.typeAr) || desc && desc.ar;
  const recAft = (rec === null || rec === void 0 ? void 0 : rec.aftermarket) || [];
  const aft = [...recAft, ...((ai === null || ai === void 0 ? void 0 : ai.aftermarket) || []).filter(a => !recAft.some(r => keyOf(r.pn) === keyOf(a.pn))).map(a => ({
    ...a,
    ai: true
  }))];
  const shownPn = (rec === null || rec === void 0 ? void 0 : rec.pn) || pn;
  const viaAlias = rec && keyOf(rec.pn) !== keyOf(pn);
  const byBrand = {};
  aft.forEach(a => {
    (byBrand[a.brand] = byBrand[a.brand] || []).push(a);
  });
  const eq = ((rec === null || rec === void 0 ? void 0 : rec.equipment) || []).length ? rec.equipment : (ai === null || ai === void 0 ? void 0 : ai.equipment) || [];
  const sup = (rec === null || rec === void 0 ? void 0 : rec.supersession) || (ai === null || ai === void 0 ? void 0 : ai.supersession);
  const oemAlt = (rec === null || rec === void 0 ? void 0 : rec.oemAlternates) || (ai === null || ai === void 0 ? void 0 : ai.oemAlternates) || [];
  const specs = (rec === null || rec === void 0 ? void 0 : rec.specs) || (ai === null || ai === void 0 ? void 0 : ai.specs) || [];
  const copy = () => {
    var _navigator$clipboard;
    const lines = [`رقم القطعة: ${shownPn}`, `الشركة: ${(rec === null || rec === void 0 ? void 0 : rec.manufacturer) || (ai === null || ai === void 0 ? void 0 : ai.manufacturer) || (b === null || b === void 0 ? void 0 : b.name) || "-"}`, `النوع: ${type || "-"}`, date ? `تاريخ الإنتاج (الملصق): ${date.text}` : "", sup && (sup.replaces || []).length ? `يحل محل: ${sup.replaces.join(", ")}` : "", sup && (sup.replacedBy || []).length ? `استُبدل بـ: ${sup.replacedBy.join(", ")}` : "", oemAlt.length ? "بدائل OEM: " + oemAlt.map(a => a.brand + " " + a.pn).join(" | ") : "", aft.length ? "Aftermarket:\n" + aft.map(a => `- ${a.brand}: ${a.pn}`).join("\n") : "", eq.length ? "المعدات: " + eq.map(e => `${e.brand} ${(e.models || []).join(", ")}`).join(" | ") : "", `المصدر: ${src === "verified" ? "قاعدة بيانات موثّقة" : src === "ai" ? "تقدير AI (غير موثّق)" : "-"}`].filter(Boolean);
    (_navigator$clipboard = navigator.clipboard) === null || _navigator$clipboard === void 0 || _navigator$clipboard.writeText(lines.join("\n")).catch(() => {});
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "part"
  }, /*#__PURE__*/React.createElement("div", {
    className: "part-top"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "pn",
    dir: "ltr"
  }, shownPn), viaAlias && /*#__PURE__*/React.createElement("div", {
    className: "alias"
  }, "\u0627\u0644\u0631\u0642\u0645 \u0627\u0644\u0644\u064A \u062F\u0648\u0651\u0631\u062A \u0639\u0644\u064A\u0647 ", /*#__PURE__*/React.createElement("code", {
    dir: "ltr"
  }, pn), " \u0645\u062A\u0633\u062C\u0651\u0644 \u0643\u0631\u0642\u0645 \u0628\u062F\u064A\u0644/\u0645\u0631\u062A\u0628\u0637 \u0644\u0644\u0642\u0637\u0639\u0629 \u062F\u064A"), /*#__PURE__*/React.createElement("div", {
    className: "pt"
  }, type || "نوع القطعة غير محدد بعد", ((rec === null || rec === void 0 ? void 0 : rec.typeEn) || (ai === null || ai === void 0 ? void 0 : ai.typeEn)) && /*#__PURE__*/React.createElement("span", {
    dir: "ltr"
  }, " \xB7 ", (rec === null || rec === void 0 ? void 0 : rec.typeEn) || (ai === null || ai === void 0 ? void 0 : ai.typeEn)))), /*#__PURE__*/React.createElement("div", {
    className: "mfr"
  }, b && /*#__PURE__*/React.createElement(Badge, {
    kind: b.oem ? "oem" : "am"
  }, b.oem ? "OEM" : "Aftermarket"), /*#__PURE__*/React.createElement("b", null, (rec === null || rec === void 0 ? void 0 : rec.manufacturer) || brandHint && (b === null || b === void 0 ? void 0 : b.name) || (ai === null || ai === void 0 ? void 0 : ai.manufacturer) || (b === null || b === void 0 ? void 0 : b.name) || "شركة غير معروفة"))), /*#__PURE__*/React.createElement("div", {
    className: "srcbar"
  }, src === "verified" && /*#__PURE__*/React.createElement(Badge, {
    kind: "ok"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ShieldCheck",
    size: 13
  }), " \u0645\u0648\u062B\u0651\u0642 \u0645\u0646 \u0645\u0635\u0627\u062F\u0631 (", (rec.sources || []).length, ")"), src === "ai" && /*#__PURE__*/React.createElement(Badge, {
    kind: "warn"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Bot",
    size: 13
  }), " \u062A\u0642\u062F\u064A\u0631 AI\u060C \u0644\u0627\u0632\u0645 \u064A\u062A\u0631\u0627\u062C\u0639 \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628"), src === "none" && /*#__PURE__*/React.createElement(Badge, {
    kind: "mute"
  }, "\u0645\u0634 \u0645\u0648\u062C\u0648\u062F \u0641\u064A \u0627\u0644\u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0645\u0648\u062B\u0651\u0642\u0629"), desc && /*#__PURE__*/React.createElement(Badge, {
    kind: "mute"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Tag",
    size: 13
  }), " \u0627\u0644\u0645\u0644\u0635\u0642: ", /*#__PURE__*/React.createElement("span", {
    dir: "ltr"
  }, desc.raw)), aiState === "busy" && /*#__PURE__*/React.createElement(Badge, {
    kind: "warn"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Loader2",
    size: 13,
    className: "spin"
  }), " \u0628\u064A\u062C\u064A\u0628 \u0627\u0644\u0645\u0639\u062F\u0627\u062A \u0648\u0627\u0644\u0628\u062F\u0627\u0626\u0644\u2026"), date && /*#__PURE__*/React.createElement(Badge, {
    kind: "date"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Calendar",
    size: 13
  }), " \u0625\u0646\u062A\u0627\u062C: ", date.text, " (\u0645\u0646 \u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0645\u0644\u0635\u0642\u060C \u0631\u0627\u062C\u0639\u0647)")), ((rec === null || rec === void 0 ? void 0 : rec.description) || (ai === null || ai === void 0 ? void 0 : ai.description)) && /*#__PURE__*/React.createElement("p", {
    className: "desc"
  }, (rec === null || rec === void 0 ? void 0 : rec.description) || (ai === null || ai === void 0 ? void 0 : ai.description)), /*#__PURE__*/React.createElement("div", {
    className: "actions"
  }, aiState !== "busy" && /*#__PURE__*/React.createElement("button", {
    className: "btn y",
    onClick: onAI
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Sparkles",
    size: 18
  }), ai ? "إعادة البحث بالـAI" : rec ? "إكمال البيانات بالـAI" : "ابحث بالـAI"), aiState === "busy" && /*#__PURE__*/React.createElement("button", {
    className: "btn y",
    disabled: true
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Loader2",
    size: 18,
    className: "spin"
  }), " \u0628\u064A\u062F\u0648\u0651\u0631 \u0639\u0644\u0649 \u0627\u0644\u0628\u062F\u0627\u0626\u0644\u2026"), /*#__PURE__*/React.createElement("button", {
    className: "btn d",
    onClick: copy
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Copy",
    size: 18
  }), " \u0646\u0633\u062E \u0627\u0644\u062A\u0642\u0631\u064A\u0631"), src !== "verified" && /*#__PURE__*/React.createElement("button", {
    className: "btn d",
    disabled: reqState === "done",
    onClick: onRequest
  }, /*#__PURE__*/React.createElement(Icon, {
    n: reqState === "done" ? "Check" : "Send",
    size: 18
  }), reqState === "done" ? "اتبعت للتوثيق" : "اطلب توثيق")), aiState && aiState.startsWith && aiState.startsWith("err") && /*#__PURE__*/React.createElement("p", {
    className: "note bad"
  }, aiState.slice(4)), specs.length > 0 && /*#__PURE__*/React.createElement(Section, {
    icon: "Ruler",
    title: "\u0627\u0644\u0645\u0648\u0627\u0635\u0641\u0627\u062A"
  }, /*#__PURE__*/React.createElement("table", {
    className: "kv"
  }, /*#__PURE__*/React.createElement("tbody", null, specs.map((s, i) => /*#__PURE__*/React.createElement("tr", {
    key: i
  }, /*#__PURE__*/React.createElement("td", null, s.k), /*#__PURE__*/React.createElement("td", {
    dir: "ltr"
  }, s.v)))))), sup && ((sup.replaces || []).length || (sup.replacedBy || []).length) || oemAlt.length ? /*#__PURE__*/React.createElement(Section, {
    icon: "Layers",
    title: "Supersession \u0648\u0627\u0644\u0628\u062F\u0627\u0626\u0644 \u0627\u0644\u0623\u0635\u0644\u064A\u0629 (OEM)"
  }, ((sup === null || sup === void 0 ? void 0 : sup.replacedBy) || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u0627\u0633\u062A\u064F\u0628\u062F\u0644 \u0628\u0640 (\u0627\u0644\u0623\u062D\u062F\u062B)"), sup.replacedBy.map(x => /*#__PURE__*/React.createElement("code", {
    key: x,
    className: "pnchip new"
  }, x))), ((sup === null || sup === void 0 ? void 0 : sup.replaces) || []).length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u0628\u064A\u062D\u0644 \u0645\u062D\u0644 (\u0623\u0642\u062F\u0645)"), sup.replaces.map(x => /*#__PURE__*/React.createElement("code", {
    key: x,
    className: "pnchip"
  }, x))), oemAlt.length > 0 && /*#__PURE__*/React.createElement("div", {
    className: "row"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u0623\u0631\u0642\u0627\u0645 OEM \u0645\u0643\u0627\u0641\u0626\u0629"), oemAlt.map((a, i) => /*#__PURE__*/React.createElement("code", {
    key: i,
    className: "pnchip"
  }, a.brand, " ", a.pn)))) : null, /*#__PURE__*/React.createElement(Section, {
    icon: "Boxes",
    title: `بدائل Aftermarket (${aft.length})`
  }, aft.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0645\u0641\u064A\u0634 \u0628\u062F\u0627\u0626\u0644 \u0645\u0633\u062C\u0651\u0644\u0629. \u062F\u0648\u0633 \"\u0627\u0628\u062D\u062B \u0628\u0627\u0644\u0640AI\" \u0623\u0648 \u0627\u0633\u062A\u062E\u062F\u0645 \u0644\u064A\u0646\u0643\u0627\u062A \u0627\u0644\u0628\u062D\u062B \u062A\u062D\u062A."), Object.entries(byBrand).map(_ref8 => {
    let [br, list] = _ref8;
    return /*#__PURE__*/React.createElement("div", {
      key: br,
      className: "am"
    }, /*#__PURE__*/React.createElement("div", {
      className: "am-b"
    }, br), /*#__PURE__*/React.createElement("div", {
      className: "am-l"
    }, list.map((a, i) => /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "am-i"
    }, /*#__PURE__*/React.createElement("code", {
      dir: "ltr"
    }, a.pn), a.ai && /*#__PURE__*/React.createElement("span", {
      className: "conf low"
    }, "AI"), a.confidence && /*#__PURE__*/React.createElement("span", {
      className: "conf " + a.confidence
    }, confAr[a.confidence] || a.confidence), a.src && /*#__PURE__*/React.createElement("a", {
      href: a.src,
      target: "_blank",
      rel: "noopener",
      className: "srclink"
    }, /*#__PURE__*/React.createElement(Icon, {
      n: "ExternalLink",
      size: 12
    }), " \u0627\u0644\u0645\u0635\u062F\u0631")))));
  })), /*#__PURE__*/React.createElement(Section, {
    icon: "Truck",
    title: "\u0627\u0644\u0645\u0639\u062F\u0627\u062A \u0627\u0644\u0644\u064A \u0628\u062A\u0633\u062A\u062E\u062F\u0645 \u0627\u0644\u0642\u0637\u0639\u0629"
  }, eq.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0645\u0634 \u0645\u062A\u0633\u062C\u0651\u0644."), eq.map((e, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "eq"
  }, /*#__PURE__*/React.createElement("b", null, e.type || e.brand), e.type && /*#__PURE__*/React.createElement("small", null, " \xB7 ", e.brand), e.engine && /*#__PURE__*/React.createElement("small", {
    dir: "ltr"
  }, " \xB7 Engine ", e.engine), e.confidence && /*#__PURE__*/React.createElement("span", {
    className: "conf " + e.confidence,
    style: {
      marginInlineStart: 6
    }
  }, confAr[e.confidence]), /*#__PURE__*/React.createElement("div", {
    className: "chips"
  }, (e.models || []).map(m => /*#__PURE__*/React.createElement("span", {
    key: m,
    className: "chip",
    dir: "ltr"
  }, m)))))), ((rec === null || rec === void 0 ? void 0 : rec.notes) || (ai === null || ai === void 0 ? void 0 : ai.notes)) && /*#__PURE__*/React.createElement(Section, {
    icon: "AlertTriangle",
    title: "\u0645\u0644\u0627\u062D\u0638\u0627\u062A \u0641\u0646\u064A\u0629"
  }, /*#__PURE__*/React.createElement("p", {
    className: "desc"
  }, (rec === null || rec === void 0 ? void 0 : rec.notes) || (ai === null || ai === void 0 ? void 0 : ai.notes))), /*#__PURE__*/React.createElement(Section, {
    icon: "Link",
    title: "\u062A\u062D\u0642\u0651\u0642 \u0645\u0646 \u0627\u0644\u0645\u0635\u062F\u0631 \u0627\u0644\u0631\u0633\u0645\u064A"
  }, /*#__PURE__*/React.createElement("div", {
    className: "links"
  }, links.map((l, i) => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: l.u,
    target: "_blank",
    rel: "noopener"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ExternalLink",
    size: 14
  }), " ", l.t))), (rec === null || rec === void 0 || (_rec$sources = rec.sources) === null || _rec$sources === void 0 ? void 0 : _rec$sources.length) > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "lbl",
    style: {
      marginTop: 10
    }
  }, "\u0645\u0635\u0627\u062F\u0631 \u0627\u0644\u062A\u0648\u062B\u064A\u0642"), /*#__PURE__*/React.createElement("div", {
    className: "links"
  }, rec.sources.map((s, i) => /*#__PURE__*/React.createElement("a", {
    key: i,
    href: s.url,
    target: "_blank",
    rel: "noopener"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "FileText",
    size: 14
  }), " ", s.title))))));
}

/* =====================================================================
   LIVE CAMERA SCANNER — reads codes continuously from the video stream
   ===================================================================== */
function LiveScanner(_ref9) {
  let {
    onDone,
    onClose
  } = _ref9;
  const vRef = useRef(),
    stopRef = useRef(false),
    streamRef = useRef(null);
  const [status, setStatus] = useState("بيفتح الكاميرا…");
  const [seen, setSeen] = useState([]);
  const seenRef = useRef([]);
  const [torch, setTorch] = useState(false);
  const grab = () => {
    const v = vRef.current;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    c.getContext("2d").drawImage(v, 0, 0);
    return new Promise(res => c.toBlob(b => res(b), "image/jpeg", 0.92));
  };
  const finish = async () => {
    if (stopRef.current) return;
    stopRef.current = true;
    const blob = await grab();
    if (navigator.vibrate) navigator.vibrate(80);
    onDone(blob, seenRef.current.slice());
  };
  useEffect(() => {
    let timer = null,
      det = null,
      reader = null,
      hints = null;
    (async () => {
      try {
        const st = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            facingMode: {
              ideal: "environment"
            },
            width: {
              ideal: 1920
            },
            height: {
              ideal: 1080
            }
          }
        });
        streamRef.current = st;
        const v = vRef.current;
        v.srcObject = st;
        await v.play();
        setStatus("وجّه الكاميرا على الكود أو الملصق");
      } catch (e) {
        setStatus("مش قادر أفتح الكاميرا. اسمح بالكاميرا للموقع من إعدادات المتصفح.");
        return;
      }
      try {
        if ("BarcodeDetector" in window) det = new BarcodeDetector({
          formats: await BarcodeDetector.getSupportedFormats()
        });
      } catch (e) {}
      const Z = window.ZXing;
      if (Z) {
        hints = new Map();
        hints.set(Z.DecodeHintType.POSSIBLE_FORMATS, [Z.BarcodeFormat.QR_CODE, Z.BarcodeFormat.DATA_MATRIX, Z.BarcodeFormat.CODE_128, Z.BarcodeFormat.CODE_39, Z.BarcodeFormat.EAN_13, Z.BarcodeFormat.UPC_A, Z.BarcodeFormat.ITF, Z.BarcodeFormat.PDF_417]);
        reader = new Z.MultiFormatReader();
        reader.setHints(hints);
      }
      const c = document.createElement("canvas");
      const x = c.getContext("2d", {
        willReadFrequently: true
      });
      let flip = 0,
        firstSeenAt = 0;
      const tick = async () => {
        if (stopRef.current) return;
        const v = vRef.current;
        if (v && v.videoWidth) {
          const found = [];
          try {
            if (det) {
              (await det.detect(v)).forEach(r => found.push({
                text: r.rawValue,
                fmt: FMT_NAMES[r.format] || r.format
              }));
            } else {
              // centre crop (where the guide box is), alternating zoom levels
              const W = v.videoWidth,
                H = v.videoHeight,
                z = [0.9, 0.55][flip++ % 2];
              const cw = W * z,
                ch = H * z,
                sc = Math.min(1, 1100 / cw);
              c.width = Math.round(cw * sc);
              c.height = Math.round(ch * sc);
              x.drawImage(v, (W - cw) / 2, (H - ch) / 2, cw, ch, 0, 0, c.width, c.height);
              const d = x.getImageData(0, 0, c.width, c.height).data;
              if (reader) {
                const lum = new Uint8ClampedArray(c.width * c.height);
                for (let i = 0, j = 0; i < d.length; i += 4, j++) lum[j] = d[i] * 77 + d[i + 1] * 150 + d[i + 2] * 29 >> 8;
                try {
                  const r = reader.decode(new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, c.width, c.height))), hints);
                  found.push({
                    text: r.getText(),
                    fmt: String(Z.BarcodeFormat[r.getBarcodeFormat()]).replace("_CODE", "").replace("_", " ")
                  });
                } catch (e) {}
              }
              if (!found.length && typeof jsQR === "function") {
                const q = jsQR(d, c.width, c.height);
                if (q && q.data) found.push({
                  text: q.data,
                  fmt: "QR"
                });
              }
            }
          } catch (e) {}
          let added = false;
          for (const f of found) if (f.text && !seenRef.current.some(s => s.text === f.text)) {
            seenRef.current.push(f);
            added = true;
          }
          if (added) {
            setSeen(seenRef.current.slice());
            if (!firstSeenAt) firstSeenAt = Date.now();
            if (navigator.vibrate) navigator.vibrate(30);
          }
          const hasPN = seenRef.current.some(f => parsePayload(f.text, f.fmt).pns.length);
          if (hasPN) {
            finish();
            return;
          }
          // a code without a part number (e.g. CAT generic QR): keep looking ~2.5 s for a barcode, then analyse the frame
          if (firstSeenAt && Date.now() - firstSeenAt > 2500) {
            finish();
            return;
          }
        }
        timer = setTimeout(tick, 120);
      };
      tick();
    })();
    return () => {
      stopRef.current = true;
      clearTimeout(timer);
      streamRef.current && streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);
  const toggleTorch = async () => {
    try {
      const t = streamRef.current.getVideoTracks()[0];
      await t.applyConstraints({
        advanced: [{
          torch: !torch
        }]
      });
      setTorch(!torch);
    } catch (e) {}
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "live"
  }, /*#__PURE__*/React.createElement("video", {
    ref: vRef,
    playsInline: true,
    muted: true,
    autoPlay: true
  }), /*#__PURE__*/React.createElement("div", {
    className: "guide"
  }, /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("i", null), /*#__PURE__*/React.createElement("div", {
    className: "scanbar"
  })), /*#__PURE__*/React.createElement("div", {
    className: "live-top"
  }, /*#__PURE__*/React.createElement("button", {
    className: "lbtn",
    onClick: onClose
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "X",
    size: 22
  })), /*#__PURE__*/React.createElement("span", null, status), /*#__PURE__*/React.createElement("button", {
    className: "lbtn",
    onClick: toggleTorch
  }, /*#__PURE__*/React.createElement(Icon, {
    n: torch ? "FlashlightOff" : "Flashlight",
    size: 20
  }))), /*#__PURE__*/React.createElement("div", {
    className: "live-bottom"
  }, /*#__PURE__*/React.createElement("div", {
    className: "live-seen"
  }, seen.map((f, i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "badge fmt"
  }, f.fmt, " \u2713"))), /*#__PURE__*/React.createElement("button", {
    className: "shutter",
    onClick: finish,
    "aria-label": "\u0635\u0648\u0651\u0631"
  }, /*#__PURE__*/React.createElement("i", null)), /*#__PURE__*/React.createElement("small", null, "\u0644\u0648 \u0627\u0644\u0645\u0644\u0635\u0642 \u0645\u0641\u064A\u0647\u0648\u0634 \u0643\u0648\u062F\u060C \u062F\u0648\u0633 \u0627\u0644\u0632\u0631\u0627\u0631 \u064A\u0635\u0648\u0651\u0631 \u0648\u064A\u0642\u0631\u0627\u0647 \u0628\u0627\u0644\u0640AI")));
}
function App() {
  const [tab, setTab] = useState("scan");
  const [apiKey, setApiKey] = useState(() => LS.get("pw_key", ""));
  const sample = useMemo(() => makeSample(apiKey), [apiKey]);
  const uid = "local";
  const [parts, setParts] = useState([]);
  const [dbState, setDbState] = useState("loading");
  const [img, setImg] = useState(null),
    [preview, setPreview] = useState(null);
  const [stage, setStage] = useState(""),
    [prog, setProg] = useState(0);
  const [codes, setCodes] = useState([]),
    [ocr, setOcr] = useState(""),
    [cands, setCands] = useState([]);
  const [pn, setPn] = useState(""),
    [brandHint, setBrandHint] = useState(null);
  const [manual, setManual] = useState("");
  const [ai, setAi] = useState(null),
    [aiState, setAiState] = useState(null),
    [reqState, setReqState] = useState(null);
  const [history, setHistory] = useState([]);
  const [labelBox, setLabelBox] = useState(null);
  const [vision, setVision] = useState(null);
  const [live, setLive] = useState(null); // null | "scan" | "search"
  const [keyDraft, setKeyDraft] = useState(() => LS.get("pw_key", "")),
    [keyMsg, setKeyMsg] = useState("");
  const exportCSV = () => {
    const rows = [["التاريخ", "رقم القطعة", "النوع", "الماركة", "موثّق", "الأكواد"]].concat(history.map(h => [new Date(h.at).toLocaleString("en-GB"), h.pn, h.type || "", h.brand || "", h.verified ? "نعم" : "لا", (h.codes || []).join(" | ")]));
    const csv = "\ufeff" + rows.map(r => r.map(v => '"' + String(v).replace(/"/g, '""') + '"').join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], {
      type: "text/csv"
    }));
    a.download = "parts-wizard-history.csv";
    a.click();
  };
  const aiCache = useRef({});
  const camRef = useRef(),
    galRef = useRef(),
    snapRef = useRef();

  // verified parts DB (data/parts.json in the repo) + local history
  useEffect(() => {
    fetch("data/parts.json", {
      cache: "no-cache"
    }).then(r => r.json()).then(d => {
      setParts(d);
      setDbState("ok");
    }).catch(() => {
      setParts(LS.get("pw_parts_cache", []));
      setDbState("off");
    });
    setHistory(LS.get("pw_history", []));
  }, []);
  useEffect(() => {
    if (parts.length) LS.set("pw_parts_cache", parts);
  }, [parts]);
  const addHistory = h => setHistory(prev => {
    const n = [{
      id: String(Date.now()),
      ...h
    }, ...prev].slice(0, 300);
    LS.set("pw_history", n);
    return n;
  });
  useEffect(() => {
    ocrProgress = m => {
      if (m.status === "recognizing text") setProg(m.progress);
    };
  }, []);
  const findRec = useCallback(p => {
    const k = keyOf(p);
    if (!k) return null;
    return parts.find(r => r.key === k || (r.aliases || []).map(keyOf).includes(k)) || null;
  }, [parts]);
  const rec = useMemo(() => findRec(pn), [pn, findRec]);
  const desc = useMemo(() => {
    var _labelDesc;
    return vision && vision.description ? {
      raw: vision.description,
      ar: vision.typeAr || ((_labelDesc = labelDesc(vision.description)) === null || _labelDesc === void 0 ? void 0 : _labelDesc.ar) || ""
    } : labelDesc(ocr);
  }, [ocr, vision]);
  useEffect(() => {
    if (!pn || !sample || stage === "codes" || stage === "ocr" || stage === "vision" || stage === "live" || dbState === "loading") return;
    const k = keyOf(pn);
    if (aiCache.current[k]) {
      setAi(aiCache.current[k]);
      return;
    }
    if (!findRec(pn) || !(findRec(pn).equipment || []).length || !(findRec(pn).aftermarket || []).length) doAI();
  }, [pn, sample, stage, dbState]);
  const date = useMemo(() => labelDate(((vision === null || vision === void 0 ? void 0 : vision.dateCode) || "") + "\n" + ocr + "\n" + codes.map(c => c.text).join("\n")), [ocr, codes, vision]);
  async function onFile(e, mode) {
    var _e$target$files;
    const f = (_e$target$files = e.target.files) === null || _e$target$files === void 0 ? void 0 : _e$target$files[0];
    e.target.value = "";
    if (!f) return;
    const im = await loadImage(f);
    analyze(im, mode);
  }
  async function analyze(im, mode, preCodes) {
    reset(true);
    if (mode === "search") {
      setTab("search");
      setManual("");
    } else setTab("scan");
    setImg(im);
    setPreview(im.src);
    setStage("codes");
    const label = findLabel(im);
    setLabelBox(label);
    let raw = preCodes || [];
    if (!raw.some(c => parsePayload(c.text, c.fmt).pns.length)) {
      const more = await decodeCodes(im, label);
      const seenT = new Set(raw.map(c => c.text));
      more.forEach(c => {
        if (!seenT.has(c.text)) raw.push(c);
      });
    }
    const parsed = raw.map(c => ({
      ...c,
      p: parsePayload(c.text, c.fmt)
    }));
    setCodes(parsed);
    let cs = parsed.flatMap(c => c.p.pns.map(x => ({
      ...x,
      brand: x.brand || c.p.brand
    })));
    const bh = parsed.map(c => c.p.brand).find(Boolean) || null;
    setBrandHint(bh);
    const codePN = cs.some(c => c.src === "code");
    let text = "";
    let canSee = false;
    try {
      canSee = !!(sample && sample.limits && (await sample.limits()).images);
    } catch (e) {}
    if (!codePN && canSee) {
      setStage("vision");
      try {
        const v = await visionRead(sample, im, label);
        setVision(v);
        text = [v.description, v.text].filter(Boolean).join("\n");
        if (v.partNumber) cs.push({
          pn: v.partNumber.toUpperCase().trim(),
          brand: (BRANDS.find(b => b.txt.test((v.brand || "").toUpperCase())) || {}).id || bh,
          src: "vision",
          strong: true
        });
        (v.otherNumbers || []).forEach(o => o && cs.push({
          pn: String(o).toUpperCase().trim(),
          brand: null,
          src: "vision"
        }));
      } catch (e) {
        console.warn("vision", e);
      }
    }
    if (!codePN && !cs.length) {
      setStage("ocr");
      setProg(0);
      try {
        text = await runOCR(im, label);
      } catch (e) {
        console.warn(e);
      }
    }
    setOcr(text);
    cs = cs.concat(extractPNs(text, bh, "ocr"));
    const bh2 = bh || (BRANDS.find(b => b.txt.test(text.toUpperCase())) || {}).id || null;
    setBrandHint(bh2);
    // rank: code > known in DB > brand-context > ocr
    const uniq = [];
    const seen = new Set();
    cs.map(c => ({
      ...c,
      score: (c.src === "code" ? 4 : c.src === "vision" ? 3 : 0) + (findRec(c.pn) ? 5 : 0) + (c.strong ? 2 : 0) + (c.brand && c.brand === bh2 ? 1 : 0)
    })).sort((a, b) => b.score - a.score).forEach(c => {
      const k = keyOf(c.pn);
      if (!seen.has(k)) {
        seen.add(k);
        uniq.push(c);
      }
    });
    setCands(uniq);
    if (uniq[0]) {
      if (mode === "search") setManual(uniq[0].pn);
      choose(uniq[0].pn, uniq[0].brand || bh2, {
        codes: parsed,
        ocr: text
      });
    }
    setStage(uniq[0] ? "done" : mode === "search" ? "nofind" : "done");
  }
  async function onLiveDone(blob, codesSeen) {
    const mode = live;
    setLive(null);
    const im = await loadImage(blob);
    analyze(im, mode, codesSeen);
  }
  function reset(keepTab) {
    setVision(null);
    setLabelBox(null);
    setImg(null);
    setPreview(null);
    setCodes([]);
    setOcr("");
    setCands([]);
    setPn("");
    setAi(null);
    setAiState(null);
    setReqState(null);
    setStage("");
    setBrandHint(null);
    if (!keepTab) setManual("");
  }
  async function choose(p, b, ctx) {
    setPn(p);
    setBrandHint(b || null);
    setAi(null);
    setAiState(null);
    setReqState(null);
    {
      const r = findRec(p);
      try {
        addHistory({
          pn: p,
          brand: b || (r === null || r === void 0 ? void 0 : r.brand) || null,
          type: (r === null || r === void 0 ? void 0 : r.typeAr) || null,
          verified: !!r,
          at: Date.now(),
          codes: ((ctx === null || ctx === void 0 ? void 0 : ctx.codes) || codes).map(c => c.text).slice(0, 4)
        });
      } catch (e) {}
    }
  }
  async function doAI() {
    if (!sample) {
      setAiState("err:البحث بالـAI محتاج مفتاح Claude API. حطه من تاب الإعدادات.");
      return;
    }
    if (aiState === "busy") return;
    setAiState("busy");
    try {
      var _brandById, _BRANDS$find;
      const r = await aiLookup(sample, pn, {
        brand: (_brandById = brandById((rec === null || rec === void 0 ? void 0 : rec.brand) || brandHint)) === null || _brandById === void 0 ? void 0 : _brandById.name,
        desc: desc === null || desc === void 0 ? void 0 : desc.raw,
        label: ocr,
        codes: codes.map(c => c.text).join(" | ")
      });
      const bid = (_BRANDS$find = BRANDS.find(b => b.name.toUpperCase().includes((r.manufacturer || "").toUpperCase().split(" ")[0]))) === null || _BRANDS$find === void 0 ? void 0 : _BRANDS$find.id;
      const v = {
        ...r,
        brandId: bid
      };
      aiCache.current[keyOf(pn)] = v;
      setAi(v);
      setAiState(null);
      setHistory(prev => {
        const n = prev.map((h, i) => i === 0 && keyOf(h.pn) === keyOf(pn) ? {
          ...h,
          type: h.type || r.typeAr || null,
          ai: true
        } : h);
        LS.set("pw_history", n);
        return n;
      });
    } catch (e) {
      setAiState(e && e.code === "rate_limited" ? "err:اتعمل طلبات كتير ورا بعض. استنى دقيقة وجرّب تاني." : e && e.code === "not_granted" ? "err:لازم توافق على السماح للأداة تسأل Claude." : "err:ماقدرتش أجيب نتيجة. جرّب تاني.");
    }
  }
  async function doRequest() {
    var _brandById2;
    const body = [`رقم القطعة: ${pn}`, `الماركة: ${((_brandById2 = brandById(brandHint)) === null || _brandById2 === void 0 ? void 0 : _brandById2.name) || "-"}`, codes.length ? `الأكواد: ${codes.map(c => c.text).join(" | ")}` : "", ocr ? `نص الملصق:\n${ocr.slice(0, 600)}` : "", ai ? `نتيجة AI: ${ai.typeAr || ""}` : ""].filter(Boolean).join("\n");
    const reqs = LS.get("pw_requests", []);
    reqs.unshift({
      pn,
      at: Date.now()
    });
    LS.set("pw_requests", reqs.slice(0, 200));
    window.open(`https://github.com/${REPO}/issues/new?title=${encodeURIComponent("توثيق: " + pn)}&labels=verify&body=${encodeURIComponent(body)}`, "_blank");
    setReqState("done");
  }
  const busy = stage === "codes" || stage === "ocr" || stage === "vision";
  const showPart = !!pn && !busy;
  return /*#__PURE__*/React.createElement("div", {
    className: "app"
  }, /*#__PURE__*/React.createElement("header", {
    className: "top"
  }, /*#__PURE__*/React.createElement("div", {
    className: "logo"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ScanLine",
    size: 26
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("h1", null, "Parts Wizard"), /*#__PURE__*/React.createElement("p", null, "QR \xB7 DataMatrix \xB7 \u0628\u0627\u0631\u0643\u0648\u062F \xB7 \u0631\u0642\u0645 \u0627\u0644\u0642\u0637\u0639\u0629 \u2190 \u0627\u0644\u0628\u062F\u0627\u0626\u0644 \u0648\u0627\u0644\u0645\u0639\u062F\u0627\u062A"))), /*#__PURE__*/React.createElement("input", {
    ref: camRef,
    type: "file",
    accept: "image/*",
    capture: "environment",
    hidden: true,
    onChange: e => onFile(e, "scan")
  }), /*#__PURE__*/React.createElement("input", {
    ref: galRef,
    type: "file",
    accept: "image/*",
    hidden: true,
    onChange: e => onFile(e, "scan")
  }), /*#__PURE__*/React.createElement("input", {
    ref: snapRef,
    type: "file",
    accept: "image/*",
    hidden: true,
    onChange: e => onFile(e, "search")
  }), /*#__PURE__*/React.createElement("nav", {
    className: "tabs"
  }, [["scan", "Camera", "فحص"], ["search", "Search", "بحث"], ["hist", "History", "السجل"], ["db", "Database", "القاعدة"], ["set", "Settings", "الإعدادات"]].map(_ref10 => {
    let [k, ic, t] = _ref10;
    return /*#__PURE__*/React.createElement("button", {
      key: k,
      className: tab === k ? "on" : "",
      onClick: () => setTab(k)
    }, /*#__PURE__*/React.createElement(Icon, {
      n: ic,
      size: 18
    }), t);
  })), tab === "scan" && /*#__PURE__*/React.createElement(React.Fragment, null, !preview && /*#__PURE__*/React.createElement("div", {
    className: "hero"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn y xl",
    onClick: () => setLive("scan")
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ScanLine",
    size: 26
  }), " \u0627\u0645\u0633\u062D \u0628\u0627\u0644\u0643\u0627\u0645\u064A\u0631\u0627"), /*#__PURE__*/React.createElement("button", {
    className: "btn d xl",
    onClick: () => galRef.current.click()
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ImagePlus",
    size: 24
  }), " \u0635\u0648\u0651\u0631 \u0623\u0648 \u0627\u062E\u062A\u0627\u0631 \u0635\u0648\u0631\u0629"), /*#__PURE__*/React.createElement("p", {
    className: "muted",
    style: {
      textAlign: "center",
      margin: 0
    }
  }, "\u0627\u0644\u0645\u0633\u062D \u0628\u064A\u0642\u0631\u0627 \u0627\u0644\u0643\u0648\u062F \u0623\u0648\u0644 \u0645\u0627 \u064A\u0638\u0647\u0631 \u0641\u064A \u0627\u0644\u0643\u0627\u0645\u064A\u0631\u0627\u060C \u0645\u0646 \u063A\u064A\u0631 \u0645\u0627 \u062A\u0635\u0648\u0651\u0631"), /*#__PURE__*/React.createElement("ul", {
    className: "tips"
  }, /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    n: "QrCode",
    size: 15
  }), " \u0628\u064A\u0642\u0631\u0627 QR \u0648DataMatrix \u0648Aztec \u0648PDF417 \u0648\u0627\u0644\u0628\u0627\u0631\u0643\u0648\u062F (Code128 / EAN) \u0641\u064A \u0646\u0641\u0633 \u0627\u0644\u0635\u0648\u0631\u0629."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    n: "FileText",
    size: 15
  }), " \u0628\u064A\u0642\u0631\u0627 \u0631\u0642\u0645 \u0627\u0644\u0642\u0637\u0639\u0629 \u0645\u0646 \u0646\u0635 \u0627\u0644\u0645\u0644\u0635\u0642 \u0643\u0645\u0627\u0646\u060C \u0639\u0634\u0627\u0646 \u0623\u063A\u0644\u0628 \u0623\u0643\u0648\u0627\u062F \u0627\u0644\u0640QR \u0639\u0644\u0649 \u0627\u0644\u062A\u063A\u0644\u064A\u0641 \u0628\u062A\u0628\u0642\u0649 \u0644\u064A\u0646\u0643 \u0639\u0627\u0645."), /*#__PURE__*/React.createElement("li", null, /*#__PURE__*/React.createElement(Icon, {
    n: "ShieldCheck",
    size: 15
  }), " \u0627\u0644\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0648\u062B\u0651\u0642\u0629 \u0645\u062A\u0639\u0644\u0651\u0645 \u0639\u0644\u064A\u0647\u0627 \u0628\u0645\u0635\u0627\u062F\u0631\u0647\u0627\u060C \u0648\u0646\u062A\u0627\u064A\u062C \u0627\u0644\u0640AI \u0645\u062A\u0639\u0644\u0651\u0645 \u0639\u0644\u064A\u0647\u0627 \u0625\u0646\u0647\u0627 \u0645\u062D\u062A\u0627\u062C\u0629 \u0645\u0631\u0627\u062C\u0639\u0629."))), preview && /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("div", {
    className: "prev"
  }, /*#__PURE__*/React.createElement("div", {
    className: "pimg"
  }, /*#__PURE__*/React.createElement("img", {
    src: preview,
    alt: ""
  }), labelBox && img && /*#__PURE__*/React.createElement("i", {
    className: "lbox",
    style: {
      left: labelBox[0] / img.naturalWidth * 100 + "%",
      top: labelBox[1] / img.naturalHeight * 100 + "%",
      width: labelBox[2] / img.naturalWidth * 100 + "%",
      height: labelBox[3] / img.naturalHeight * 100 + "%"
    }
  }), busy && /*#__PURE__*/React.createElement("div", {
    className: "laser"
  }))), /*#__PURE__*/React.createElement("div", {
    className: "row2"
  }, /*#__PURE__*/React.createElement("button", {
    className: "btn d",
    disabled: busy,
    onClick: () => galRef.current.click()
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Camera",
    size: 18
  }), " \u0635\u0648\u0631\u0629 \u062C\u062F\u064A\u062F\u0629"), /*#__PURE__*/React.createElement("button", {
    className: "btn ghost",
    disabled: busy,
    onClick: () => reset()
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Trash2",
    size: 18
  }))), busy && /*#__PURE__*/React.createElement("div", {
    className: "stage"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Loader2",
    size: 16,
    className: "spin"
  }), " ", stage === "codes" ? "بيدوّر على الأكواد…" : stage === "vision" ? "Claude بيقرا الملصق…" : "بيقرا نص الملصق… " + Math.round(prog * 100) + "%", stage === "ocr" && /*#__PURE__*/React.createElement("div", {
    className: "bar"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: prog * 100 + "%"
    }
  })))), !busy && preview && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Section, {
    icon: "QrCode",
    title: `الأكواد المقروءة (${codes.length})`
  }, codes.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0645\u0627\u0644\u0642\u064A\u062A\u0634 QR \u0648\u0644\u0627 \u0628\u0627\u0631\u0643\u0648\u062F. \u0642\u0631\u0651\u0628 \u0627\u0644\u0643\u0627\u0645\u064A\u0631\u0627 \u0639\u0644\u0649 \u0627\u0644\u0643\u0648\u062F\u060C \u0648\u062E\u0644\u0651\u064A\u0647 \u0648\u0627\u0636\u062D \u0648\u0645\u0646 \u063A\u064A\u0631 \u0644\u0645\u0639\u0629."), codes.map((c, i) => /*#__PURE__*/React.createElement(CodeCard, {
    key: i,
    c: c
  }))), /*#__PURE__*/React.createElement(Section, {
    icon: "Hash",
    title: "\u0623\u0631\u0642\u0627\u0645 \u0627\u0644\u0642\u0637\u0639 \u0627\u0644\u0645\u0643\u062A\u0634\u0641\u0629"
  }, cands.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0645\u0627\u0644\u0642\u064A\u062A\u0634 \u0631\u0642\u0645 \u0642\u0637\u0639\u0629. \u0627\u0643\u062A\u0628\u0647 \u0641\u064A \u062A\u0628\u0648\u064A\u0628 \"\u0628\u062D\u062B \u0628\u0631\u0642\u0645\"."), /*#__PURE__*/React.createElement("div", {
    className: "cands"
  }, cands.slice(0, 8).map((c, i) => /*#__PURE__*/React.createElement("button", {
    key: i,
    className: "cand " + (keyOf(c.pn) === keyOf(pn) ? "on" : ""),
    onClick: () => choose(c.pn, c.brand)
  }, /*#__PURE__*/React.createElement("code", {
    dir: "ltr"
  }, c.pn), /*#__PURE__*/React.createElement("small", null, c.brand && brandById(c.brand) ? brandById(c.brand).name : "", " \xB7 ", c.src === "code" ? "من الكود" : c.src === "vision" ? "قراءة ذكية" : "من النص", findRec(c.pn) ? " · موثّق" : "")))), ocr && /*#__PURE__*/React.createElement("details", {
    className: "ocr"
  }, /*#__PURE__*/React.createElement("summary", null, "\u0646\u0635 \u0627\u0644\u0645\u0644\u0635\u0642 \u0627\u0644\u0645\u0642\u0631\u0648\u0621"), /*#__PURE__*/React.createElement("pre", {
    dir: "ltr"
  }, ocr)))), showPart && /*#__PURE__*/React.createElement(PartView, {
    pn: pn,
    brandHint: brandHint,
    rec: rec,
    ai: ai,
    aiState: aiState,
    onAI: doAI,
    onRequest: doRequest,
    reqState: reqState,
    ocrText: ocr,
    date: date,
    desc: desc
  })), tab === "search" && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("form", {
    onSubmit: e => {
      var _c$, _c$2;
      e.preventDefault();
      const v = manual.trim();
      if (!v) return;
      const c = extractPNs(v, null, "manual");
      const b = ((_c$ = c[0]) === null || _c$ === void 0 ? void 0 : _c$.brand) || (BRANDS.find(b => b.txt.test(v.toUpperCase())) || {}).id || null;
      setCodes([]);
      setOcr("");
      choose(((_c$2 = c[0]) === null || _c$2 === void 0 ? void 0 : _c$2.pn) || v.toUpperCase(), b);
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "sbox"
  }, /*#__PURE__*/React.createElement("input", {
    dir: "ltr",
    value: manual,
    onChange: e => setManual(e.target.value.toUpperCase()),
    placeholder: "1R-1808 \xB7 207-60-71182 \xB7 P551808 \xB7 LF9018",
    autoCapitalize: "characters",
    spellCheck: false
  }), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "btn d snap",
    title: "\u0627\u0645\u0633\u062D \u0628\u0627\u0644\u0643\u0627\u0645\u064A\u0631\u0627",
    onClick: () => setLive("search")
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Camera",
    size: 20
  })), /*#__PURE__*/React.createElement("button", {
    className: "btn y"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Search",
    size: 18
  }), " \u0628\u062D\u062B"))), busy && tab === "search" && /*#__PURE__*/React.createElement("div", {
    className: "stage"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Loader2",
    size: 16,
    className: "spin"
  }), " ", stage === "codes" ? "بيدوّر على الأكواد…" : stage === "vision" ? "Claude بيقرا رقم القطعة من الصورة…" : "بيقرا النص… " + Math.round(prog * 100) + "%"), stage === "nofind" && tab === "search" && /*#__PURE__*/React.createElement("p", {
    className: "note bad"
  }, "\u0645\u0627\u0644\u0642\u064A\u062A\u0634 \u0631\u0642\u0645 \u0642\u0637\u0639\u0629 \u0641\u064A \u0627\u0644\u0635\u0648\u0631\u0629. \u0642\u0631\u0651\u0628 \u0627\u0644\u0643\u0627\u0645\u064A\u0631\u0627 \u0639\u0644\u0649 \u0627\u0644\u0631\u0642\u0645\u060C \u0623\u0648 \u0627\u0643\u062A\u0628\u0647."), !busy && !pn && /*#__PURE__*/React.createElement("p", {
    className: "muted",
    style: {
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Camera",
    size: 13
  }), " \u062F\u0648\u0633 \u0627\u0644\u0643\u0627\u0645\u064A\u0631\u0627 \u0648\u0648\u062C\u0651\u0647\u0647\u0627 \u0639\u0644\u0649 \u0631\u0642\u0645 \u0627\u0644\u0642\u0637\u0639\u0629 \u0623\u0648 \u0627\u0644\u0645\u0644\u0635\u0642\u060C \u0648\u0627\u0644\u0628\u062D\u062B \u0647\u064A\u0628\u062F\u0623 \u0644\u0648\u062D\u062F\u0647. ", /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "mini",
    onClick: () => snapRef.current.click()
  }, "\u0623\u0648 \u0627\u062E\u062A\u0627\u0631 \u0635\u0648\u0631\u0629")), /*#__PURE__*/React.createElement("div", {
    className: "quick"
  }, parts.slice(0, 12).map(p => /*#__PURE__*/React.createElement("button", {
    key: p.id,
    onClick: () => {
      setManual(p.pn);
      setCodes([]);
      setOcr("");
      choose(p.pn, p.brand);
    },
    dir: "ltr"
  }, p.pn)))), pn && !busy && /*#__PURE__*/React.createElement(PartView, {
    pn: pn,
    brandHint: brandHint,
    rec: rec,
    ai: ai,
    aiState: aiState,
    onAI: doAI,
    onRequest: doRequest,
    reqState: reqState,
    date: date,
    desc: desc
  })), tab === "hist" && /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, history.length > 0 && /*#__PURE__*/React.createElement("button", {
    className: "btn d",
    style: {
      width: "100%",
      marginBottom: 8
    },
    onClick: exportCSV
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Download",
    size: 18
  }), " \u062A\u0635\u062F\u064A\u0631 \u0627\u0644\u0633\u062C\u0644 (Excel / CSV)"), uid && history.length === 0 && /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0644\u0633\u0647 \u0645\u0641\u064A\u0634 \u0641\u062D\u0648\u0635\u0627\u062A."), history.map(h => {
    var _brandById3;
    return /*#__PURE__*/React.createElement("button", {
      key: h.id,
      className: "hrow",
      onClick: () => {
        setTab("search");
        setManual(h.pn);
        setCodes([]);
        setOcr("");
        setPn(h.pn);
        setBrandHint(h.brand);
        setAi(null);
      }
    }, /*#__PURE__*/React.createElement("code", {
      dir: "ltr"
    }, h.pn), /*#__PURE__*/React.createElement("span", null, h.type || h.brand && ((_brandById3 = brandById(h.brand)) === null || _brandById3 === void 0 ? void 0 : _brandById3.name) || ""), h.verified ? /*#__PURE__*/React.createElement(Badge, {
      kind: "ok"
    }, "\u0645\u0648\u062B\u0651\u0642") : h.ai ? /*#__PURE__*/React.createElement(Badge, {
      kind: "warn"
    }, "AI") : null, /*#__PURE__*/React.createElement("small", null, new Date(h.at).toLocaleString("ar-EG", {
      dateStyle: "short",
      timeStyle: "short"
    })));
  })), tab === "db" && /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, dbState === "ok" ? `القاعدة الموثّقة فيها ${parts.length} قطعة، كل رقم متسجّل معاه مصدره.` : dbState === "off" ? "القاعدة مش متاحة في العرض ده." : dbState === "slow" ? "القاعدة لسه بتحمّل…" : "بيحمّل…"), parts.map(p => {
    var _brandById4, _brandById5;
    return /*#__PURE__*/React.createElement("button", {
      key: p.id,
      className: "hrow",
      onClick: () => {
        setTab("search");
        setManual(p.pn);
        setCodes([]);
        setOcr("");
        choose(p.pn, p.brand);
      }
    }, /*#__PURE__*/React.createElement("code", {
      dir: "ltr"
    }, p.pn), /*#__PURE__*/React.createElement("span", null, p.typeAr), /*#__PURE__*/React.createElement(Badge, {
      kind: (_brandById4 = brandById(p.brand)) !== null && _brandById4 !== void 0 && _brandById4.oem ? "oem" : "am"
    }, ((_brandById5 = brandById(p.brand)) === null || _brandById5 === void 0 ? void 0 : _brandById5.name) || p.brand), /*#__PURE__*/React.createElement("small", null, (p.aftermarket || []).length, " \u0628\u062F\u064A\u0644"));
  }), /*#__PURE__*/React.createElement("p", {
    className: "disc"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "Info",
    size: 14
  }), " \u0623\u064A \u0631\u0642\u0645 \u0645\u0634 \u0645\u0648\u062C\u0648\u062F \u0647\u0646\u0627\u060C \u062F\u0648\u0633 \"\u0627\u0637\u0644\u0628 \u062A\u0648\u062B\u064A\u0642\" \u0645\u0646 \u0635\u0641\u062D\u062A\u0647\u060C \u0648\u0647\u064A\u062A\u0631\u0627\u062C\u0639 \u0648\u064A\u062A\u0636\u0627\u0641 \u0644\u0644\u0642\u0627\u0639\u062F\u0629 \u0628\u0645\u0635\u0627\u062F\u0631\u0647.")), tab === "set" && /*#__PURE__*/React.createElement("div", {
    className: "card"
  }, /*#__PURE__*/React.createElement("h3", {
    style: {
      marginTop: 0
    }
  }, "\u0645\u0641\u062A\u0627\u062D Claude API"), /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0627\u0644\u0642\u0631\u0627\u0621\u0629 \u0627\u0644\u0630\u0643\u064A\u0629 \u0644\u0644\u0645\u0644\u0635\u0642\u0627\u062A \u0648\u0627\u0644\u0628\u062D\u062B \u0639\u0646 \u0627\u0644\u0628\u062F\u0627\u0626\u0644 \u0648\u0627\u0644\u0645\u0639\u062F\u0627\u062A \u0645\u062D\u062A\u0627\u062C\u064A\u0646 \u0645\u0641\u062A\u0627\u062D \u0645\u0646 console.anthropic.com. \u0627\u0644\u0645\u0633\u062D \u0648\u0627\u0644\u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0645\u0648\u062B\u0651\u0642\u0629 \u0634\u063A\u0627\u0644\u064A\u0646 \u0645\u0646 \u063A\u064A\u0631\u0647. \u0627\u0644\u0645\u0641\u062A\u0627\u062D \u0628\u064A\u062A\u062D\u0641\u0638 \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0628\u0627\u064A\u0644 \u062F\u0647 \u0628\u0633."), /*#__PURE__*/React.createElement("div", {
    className: "sbox"
  }, /*#__PURE__*/React.createElement("input", {
    dir: "ltr",
    type: "password",
    value: keyDraft,
    onChange: e => setKeyDraft(e.target.value.trim()),
    placeholder: "sk-ant-...",
    autoComplete: "off"
  }), /*#__PURE__*/React.createElement("button", {
    className: "btn y",
    onClick: () => {
      LS.set("pw_key", keyDraft);
      setApiKey(keyDraft);
      setKeyMsg(keyDraft ? "اتحفظ ✓" : "اتمسح");
    }
  }, "\u062D\u0641\u0638")), keyMsg && /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, keyMsg), /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0627\u0644\u062D\u0627\u0644\u0629: ", apiKey ? "✅ القراءة الذكية مفعّلة" : "⚪ القراءة الذكية مش مفعّلة"), /*#__PURE__*/React.createElement("a", {
    className: "links-a",
    href: "https://console.anthropic.com/settings/keys",
    target: "_blank",
    rel: "noopener"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ExternalLink",
    size: 14
  }), " \u0627\u0639\u0645\u0644 \u0645\u0641\u062A\u0627\u062D \u0645\u0646 Anthropic Console"), /*#__PURE__*/React.createElement("h3", null, "\u0637\u0644\u0628\u0627\u062A \u0627\u0644\u062A\u0648\u062B\u064A\u0642"), /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "\u0632\u0631\u0627\u0631 \"\u0627\u0637\u0644\u0628 \u062A\u0648\u062B\u064A\u0642\" \u0628\u064A\u0641\u062A\u062D \u0637\u0644\u0628 \u0639\u0644\u0649 GitHub \u0628\u0627\u0644\u0631\u0642\u0645 \u0648\u0628\u064A\u0627\u0646\u0627\u062A \u0627\u0644\u0645\u0644\u0635\u0642\u060C \u0648\u0628\u064A\u062A\u0631\u0627\u062C\u0639 \u0648\u064A\u062A\u0636\u0627\u0641 \u0644\u0644\u0642\u0627\u0639\u062F\u0629 \u0628\u0645\u0635\u0627\u062F\u0631\u0647."), /*#__PURE__*/React.createElement("a", {
    className: "links-a",
    href: `https://github.com/${REPO}/issues`,
    target: "_blank",
    rel: "noopener"
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ExternalLink",
    size: 14
  }), " \u0627\u0644\u0637\u0644\u0628\u0627\u062A \u0627\u0644\u0645\u0641\u062A\u0648\u062D\u0629"), /*#__PURE__*/React.createElement("h3", null, "\u0639\u0646 \u0627\u0644\u062A\u0637\u0628\u064A\u0642"), /*#__PURE__*/React.createElement("p", {
    className: "muted"
  }, "Parts Wizard \xB7 \u0627\u0644\u0642\u0627\u0639\u062F\u0629 \u0627\u0644\u0645\u0648\u062B\u0651\u0642\u0629 \u0641\u064A\u0647\u0627 ", parts.length, " \u0642\u0637\u0639\u0629 \xB7 \u0643\u0644 \u0627\u0644\u0623\u0643\u0648\u0627\u062F \u0648\u0627\u0644\u0635\u0648\u0631 \u0628\u062A\u062A\u0642\u0631\u064A \u0639\u0644\u0649 \u0627\u0644\u0645\u0648\u0628\u0627\u064A\u0644 \u0646\u0641\u0633\u0647.")), (tab === "scan" || tab === "search") && !busy && !live && (preview || pn) && /*#__PURE__*/React.createElement("button", {
    className: "fab",
    onClick: () => setLive(tab === "search" ? "search" : "scan")
  }, /*#__PURE__*/React.createElement(Icon, {
    n: "ScanLine",
    size: 22
  }), " ", tab === "search" ? "امسح رقم تاني" : "فحص التالي"), live && /*#__PURE__*/React.createElement(LiveScanner, {
    onDone: onLiveDone,
    onClose: () => setLive(null)
  }), /*#__PURE__*/React.createElement("footer", null, "Parts Wizard \xB7 \u0627\u0644\u0628\u062F\u0627\u0626\u0644 \u0644\u0627\u0632\u0645 \u062A\u062A\u0637\u0627\u0628\u0642 \u0645\u0639 \u0627\u0644\u0645\u0642\u0627\u0633\u0627\u062A \u0648\u0627\u0644\u0633\u064A\u0631\u064A\u0627\u0644 \u0642\u0628\u0644 \u0627\u0644\u0637\u0644\u0628"));
}
class Boundary extends React.Component {
  constructor(p) {
    super(p);
    this.state = {
      err: null
    };
  }
  static getDerivedStateFromError(err) {
    return {
      err
    };
  }
  render() {
    if (this.state.err) return /*#__PURE__*/React.createElement("div", {
      className: "card",
      style: {
        margin: 16
      }
    }, /*#__PURE__*/React.createElement("h3", {
      style: {
        color: "#fca5a5"
      }
    }, "\u062D\u0635\u0644 \u062E\u0637\u0623 \u0641\u064A \u0627\u0644\u0623\u062F\u0627\u0629"), /*#__PURE__*/React.createElement("p", {
      className: "muted"
    }, "\u0635\u0648\u0651\u0631 \u0627\u0644\u0634\u0627\u0634\u0629 \u062F\u064A \u0648\u0627\u0628\u0639\u062A\u0647\u0627\u0644\u064A:"), /*#__PURE__*/React.createElement("pre", {
      dir: "ltr"
    }, String(this.state.err && (this.state.err.stack || this.state.err.message || this.state.err)).slice(0, 800)), /*#__PURE__*/React.createElement("button", {
      className: "btn y",
      onClick: () => this.setState({
        err: null
      })
    }, "\u0631\u062C\u0648\u0639"));
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById("root")).render(/*#__PURE__*/React.createElement(Boundary, null, /*#__PURE__*/React.createElement(App, null)));
window.__appStarted = true;