/**
 * Check data phuc vu sinh but toan thanh toan theo 1 paymentId.
 * OpenText/Micro Focus Service Manager JavaScript.
 * CHI DOC DU LIEU, KHONG INSERT/UPDATE/DELETE.
 */

/* Khi chay truc tiep trong JavaScript Test, chi sua gia tri nay. */
var PAYMENT_ID = 'TT.XXX.XX.XXXXXXX';
var EPSILON = 0.001;

run();

function run() {
  var input = null;
  try { input = vars['$L.file']; } catch (ignoreInput) {}

  /* Khi goi qua gateway, chi can truyen: { "paymentId": "..." } */
  var paymentId = safeString(input && input.paymentId).trim() || PAYMENT_ID;
  var result = inspectPayment(paymentId);
  var output = JSON.stringify(result);

  try { print(output); } catch (ignorePrint) {}
  try { if (input) input.queryReturn = output; } catch (ignoreReturn) {}
  return result;
}

function inspectPayment(paymentId) {
  var result = {
    success: true,
    paymentId: paymentId,
    payment: null,
    vendors: [],
    invoices: [],
    costDivisions: [],
    taxCategories: [],
    savedEntries: [],
    organization: {},
    summary: { vendorCount: 0, invoiceCount: 0, costDivisionCount: 0, savedEntryCount: 0 },
    errors: [],
    warnings: []
  };

  if (!paymentId || paymentId === 'TT.XXX.XX.XXXXXXX') {
    result.success = false;
    result.errors.push('Thieu paymentId.');
    return result;
  }

  result.payment = selectOne('esdHTKTpayment', 'id="' + escapeValue(paymentId) + '"', [
    'id', 'department', 'description', 'current.phase', 'user.checker.kttc',
    'initial.role', 'created.by', 'total.advance.amount', 'total.amount.paid',
    'total.refund.amount', 'currentcy'
  ], result.errors);

  if (!result.payment) {
    result.success = false;
    result.errors.push('Khong tim thay payment tai esdHTKTpayment: ' + paymentId);
    return result;
  }

  var vendorRows = selectMany('esdHTKTpaymentVendor',
    'payment.id="' + escapeValue(paymentId) + '"', [
      'payment.id', 'vendor.id', 'vendor.site.id', 'approved.invoice.amount',
      'amount', 'refund.amount', 'vendor.type', 'currency', 'payment.method',
      'beneficiary.account', 'beneficiary.name', 'beneficiary.bank',
      'transaction.des', 'exchange.rate', 'payment.rate'
    ], result.errors);

  var links = selectMany('esdHTKTpaymentInvoice',
    'payment.id="' + escapeValue(paymentId) + '"', [
      'payment.id', 'invoice.id', 'deduction.type', 'deduction.amount', 'deduction.rate'
    ], result.errors);

  for (var li = 0; li < links.length; li++) {
    var invoice = selectOne('esdHTKTinvoice',
      'id="' + escapeValue(links[li]['invoice.id']) + '"', [
        'id', 'total.tax', 'exchange.rate', 'seller.tax.code'
      ], result.errors);
    links[li].invoice = invoice || {};
  }
  result.invoices = links;

  result.costDivisions = selectMany('esdHTKTpaymentCostDivision',
    'payment.id="' + escapeValue(paymentId) + '"', [
      'id', 'payment.id', 'vendor.id', 'order', 'account.number', 'account.name',
      'amount', 'currency', 'department',
      'department.name', 'branch', 'description'
    ], result.errors);

  result.savedEntries = selectMany('esdHTKTpaymentEntry',
    'payment.id="' + escapeValue(paymentId) + '"', [
      'id', 'payment.id', 'entry.type', 'ledger.type', 'account.type',
      'account.number', 'account.name', 'branch', 'department', 'transaction.code',
      'amount', 'currency', 'description', 'vendor.id', 'type', 'order',
      'accounting.request.id'
    ], result.errors);

  result.taxCategories = loadTaxCategories(result.errors);
  result.organization = loadOrganization(result.payment['created.by'], result.errors);

  for (var vi = 0; vi < vendorRows.length; vi++) {
    var vendorRow = vendorRows[vi];
    var vendorId = safeString(vendorRow['vendor.id']).trim();
    var siteId = safeString(vendorRow['vendor.site.id']).trim();

    vendorRow.vendor = selectOne('esdHTKTvendor',
      'id="' + escapeValue(vendorId) + '"',
      ['id', 'vendor.name', 'vendor.number'], result.errors) || {};
    vendorRow.vendorSite = selectVendorSite(siteId, vendorId, result.errors);
    if (vendorRow.vendorSite.lookupWarning) {
      result.warnings.push('NCC ' + vendorId + ': ' + vendorRow.vendorSite.lookupWarning);
    }
    vendorRow.costDivisions = filterBy(result.costDivisions, 'vendor.id', vendorId);
    vendorRow.invoices = invoicesForVendor(links, vendorRow, vendorRows.length);
    vendorRow.hasTax = hasDeductibleTax(vendorRow.invoices);
    vendorRow.hasUserAccountingAction = hasUserAccountingAction(
      result.savedEntries,
      paymentId,
      vendorId
    );
    vendorRow.expectedCase = classifyCase(
      numberValue(vendorRow['approved.invoice.amount']),
      numberValue(vendorRow.amount),
      numberValue(vendorRow['refund.amount']),
      isPersonal(vendorRow['vendor.type']),
      vendorRow.hasTax,
      vendorRow.hasUserAccountingAction
    );
    vendorRow.dataIssues = validateVendorData(vendorRow);

    if (!vendorRow.expectedCase) {
      result.errors.push('NCC ' + (vendorId || '?') + ': bo 3 so tien khong khop TT-01..TT-17.');
    }
    for (var issueIndex = 0; issueIndex < vendorRow.dataIssues.length; issueIndex++) {
      result.errors.push('NCC ' + (vendorId || '?') + ': ' + vendorRow.dataIssues[issueIndex]);
    }
    result.vendors.push(vendorRow);
  }

  if (result.vendors.length === 0) result.errors.push('Khong co NCC tai esdHTKTpaymentVendor.');
  if (result.payment['current.phase'] !== 'initial_dmms' &&
      result.payment['current.phase'] !== 'initial_kttc') {
    result.warnings.push('current.phase khong nam trong phase cho phep sinh: initial_dmms/initial_kttc.');
  }

  result.summary.vendorCount = result.vendors.length;
  result.summary.invoiceCount = result.invoices.length;
  result.summary.costDivisionCount = result.costDivisions.length;
  result.summary.savedEntryCount = result.savedEntries.length;
  result.errors = unique(result.errors);
  result.warnings = unique(result.warnings);
  result.success = result.errors.length === 0;
  return result;
}

function validateVendorData(v) {
  var issues = [];
  if (!v['vendor.id']) issues.push('thieu vendor.id');
  if (!v['vendor.site.id']) issues.push('thieu vendor.site.id');
  if (!v.currency) issues.push('thieu currency');
  if (!v.vendor['vendor.number']) issues.push('thieu vendor.number');
  /* ogl.site.code duoc validate tai buoc mapping/call API, khong chan sinh but toan. */
  /* credit.account chi bat buoc neu dong tu sinh thuc te can TK phai tra.
     TT-11..TT-16 khong bi chan o validate NCC vi khong tu sinh dong Co. */

  if (numberValue(v.amount) > EPSILON) {
    if (!v['payment.method']) issues.push('thieu payment.method');
    if (isBankTransfer(v['payment.method'])) {
      if (!v['beneficiary.account']) issues.push('thieu beneficiary.account');
      if (!v['beneficiary.name']) issues.push('thieu beneficiary.name');
      if (!v['beneficiary.bank']) issues.push('thieu beneficiary.bank');
    }
  }

  /* Khong co PCCP khong phai loi: code sinh but toan fallback sang
     vendorSite.debit.account. Chi loi neu ca PCCP va debit.account deu thieu. */
  if (numberValue(v['approved.invoice.amount']) > EPSILON &&
      v.costDivisions.length === 0 && !v.vendorSite['debit.account']) {
    issues.push('khong co PCCP va thieu vendorSite.debit.account');
  }
  for (var i = 0; i < v.costDivisions.length; i++) {
    if (!v.costDivisions[i]['account.number']) issues.push('PCCP ' + v.costDivisions[i].id + ' thieu account.number');
  }
  return unique(issues);
}

function selectVendorSite(siteId, vendorId, errors) {
  var fields = ['id', 'vendor.id', 'ogl.site.code', 'debit.account', 'credit.account'];
  var exact = selectOne('esdHTKTvendorSite',
    'id="' + escapeValue(siteId) + '"', fields, errors);
  if (exact) return exact;

  var candidates = selectMany('esdHTKTvendorSite',
    'vendor.id="' + escapeValue(vendorId) + '"', fields, errors);
  for (var i = 0; i < candidates.length; i++) {
    if (lookupIdsEqual(candidates[i].id, siteId)) return candidates[i];
  }
  if (candidates.length === 1) {
    candidates[0].lookupWarning = 'vendor.site.id=' + siteId +
      ' khong khop id=' + candidates[0].id + '; dang dung Vendor Site duy nhat cua NCC.';
    return candidates[0];
  }
  return {};
}

function lookupIdsEqual(left, right) {
  var a = safeString(left).trim();
  var b = safeString(right).trim();
  if (a === b) return true;
  if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
    return a.replace(/^0+/, '') === b.replace(/^0+/, '');
  }
  return false;
}

function classifyCase(invoice, payment, refund, personal, tax, userAccountingAction) {
  // BANG QUYET DINH la nguon quy tac uu tien cao nhat.
  // Case trung dieu kien phan biet bang AP/PREPAYMENT, AP/PAYABLE thu cong hoac GL.
  if (isZero(invoice) && isPositive(payment)) return 'TT-17';
  if (isZero(refund) && equals(invoice, payment)) return personal ? 'TT-02' : (tax ? 'TT-03' : 'TT-01');
  if (isZero(refund) && greater(invoice, payment)) return personal ? 'TT-05' : (tax ? 'TT-06' : 'TT-04');
  if (isPositive(refund) && isZero(payment) && equals(invoice, refund)) return 'TT-07';
  if (isPositive(refund) && isZero(payment) && !equals(invoice, refund)) return personal ? 'TT-13' : (tax ? 'TT-12' : 'TT-11');
  if (isPositive(refund) && isPositive(payment)) {
    var baseCase = personal ? 'TT-10' : (tax ? 'TT-09' : 'TT-08');
    return userAccountingAction ? toHumanActionCase(baseCase) : baseCase;
  }
  return '';
}

function toHumanActionCase(baseCase) {
  if (baseCase === 'TT-08') return 'TT-14';
  if (baseCase === 'TT-09') return 'TT-15';
  if (baseCase === 'TT-10') return 'TT-16';
  return baseCase;
}

function hasUserAccountingAction(entries, paymentId, vendorId) {
  var manualMarker = '.MANUAL.AP.';

  for (var i = 0; i < entries.length; i++) {
    var row = entries[i];
    if (safeString(row['payment.id']) !== safeString(paymentId)) continue;
    if (safeString(row['vendor.id']) !== safeString(vendorId)) continue;
    var type = safeString(row.type).toUpperCase();
    var entryType = safeString(row['entry.type']).toUpperCase();
    if (type === 'GL') return true;
    if (type === 'AP' && entryType === 'PREPAYMENT') return true;
    if (type === 'AP' && entryType === 'PAYABLE' &&
        safeString(row['account.type']).toUpperCase() === 'ASSET' &&
        safeString(row.id).indexOf(manualMarker) >= 0) return true;
  }

  return false;
}

function invoicesForVendor(links, vendorRow, vendorCount) {
  var result = [];
  var vendorTax = identity(vendorRow.vendor['vendor.number']);
  for (var i = 0; i < links.length; i++) {
    var invoiceTax = identity(links[i].invoice['seller.tax.code']);
    if ((vendorTax && invoiceTax === vendorTax) || vendorCount === 1) result.push(links[i]);
  }
  return result;
}

function hasDeductibleTax(links) {
  for (var i = 0; i < links.length; i++) {
    var type = safeString(links[i]['deduction.type']).toUpperCase();
    if (numberValue(links[i].invoice['total.tax']) > EPSILON &&
        (type === 'KHAU_TRU_TOAN_BO' || type === 'KHAU_TRU_TY_LE')) return true;
  }
  return false;
}

function loadTaxCategories(errors) {
  var rows = [];
  var ids = ['KHAU_TRU_TOAN_BO', 'KHAU_TRU_TY_LE', 'KHONG_KHAU_TRU'];
  var categories = ['dmhd_loai_khau_tru', 'dmhtkt_loai_khau_tru'];
  for (var c = 0; c < categories.length; c++) {
    for (var i = 0; i < ids.length; i++) {
      var row = selectOne('esdDMcategoryItems',
        'category.id="' + categories[c] + '" and item.id="' + ids[i] + '"',
        ['category.id', 'item.id', 'item.name'], errors);
      if (row) rows.push(row);
    }
  }
  return rows;
}

function loadOrganization(createdBy, errors) {
  var result = { contact: null, creatorEntity: null, lv2Units: [] };
  if (!createdBy) return result;
  result.contact = selectOne('contacts', 'contact.name="' + escapeValue(createdBy) + '"',
    ['contact.name', 'lv1.id'], errors);
  if (!result.contact) return result;
  var lv1Id = safeString(result.contact['lv1.id']).trim();
  var psCode = lv1Id.charAt(0) === '0' ? lv1Id.substring(1) : lv1Id;
  result.creatorEntity = selectOne('esdDMentity', 'ps.code="' + escapeValue(psCode) + '"',
    ['ps.code', 'entity.code', 'ogl.branch.code', 'org.transaction.code', 'branch.name'], errors);
  result.lv2Units = selectMany('esdQTorgUnit', 'parent.id="' + escapeValue(lv1Id) + '"',
    ['unit.id', 'unit.name', 'parent.id'], errors);
  return result;
}

function selectOne(table, query, fields, errors) {
  var rows = selectMany(table, query, fields, errors, 1);
  return rows.length ? rows[0] : null;
}

function selectMany(table, query, fields, errors, limit) {
  var rows = [], file = null, rc;
  try {
    file = new SCFile(table, SCFILE_READONLY);
    rc = file.doSelect(query);
    while (rc === RC_SUCCESS && (!limit || rows.length < limit)) {
      var row = {};
      for (var i = 0; i < fields.length; i++) row[fields[i]] = readField(file, fields[i]);
      rows.push(row);
      rc = file.getNext();
    }
  } catch (e) {
    errors.push(table + ': ' + e.toString());
  }
  closeFile(file);
  return rows;
}

function readField(file, field) {
  try {
    var value = file[field];
    return value === null || value === undefined ? '' : value;
  } catch (e) { return ''; }
}

function filterBy(rows, field, value) {
  var result = [];
  for (var i = 0; i < rows.length; i++) if (safeString(rows[i][field]) === value) result.push(rows[i]);
  return result;
}

function unique(values) {
  var seen = {}, result = [];
  for (var i = 0; i < values.length; i++) {
    var value = safeString(values[i]);
    if (value && !seen[value]) { seen[value] = true; result.push(value); }
  }
  return result;
}

function numberValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  var n = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
  return isNaN(n) ? 0 : n;
}

function isZero(value) { return Math.abs(numberValue(value)) <= EPSILON; }
function isPositive(value) { return numberValue(value) > EPSILON; }
function equals(a, b) { return Math.abs(numberValue(a) - numberValue(b)) <= EPSILON; }
function greater(a, b) { return numberValue(a) - numberValue(b) > EPSILON; }
function isPersonal(value) {
  var normalized = normalize(value).replace(/\s+/g, '');
  return normalized === 'cn' || normalized === 'canhan';
}
function isBankTransfer(value) { return normalize(value).replace(/\s+/g, '') === 'chuyenkhoan'; }
function identity(value) { return normalize(value).replace(/[^a-z0-9]/g, ''); }
function normalize(value) {
  var text = safeString(value).toLowerCase();
  try { if (text.normalize) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {}
  return text.replace(/\u0111/g, 'd').replace(/\s+/g, ' ').trim();
}
function safeString(value) { return value === null || value === undefined ? '' : String(value); }
function escapeValue(value) { return safeString(value).replace(/"/g, '\\"'); }
function closeFile(file) {
  try {
    if (file && typeof file.doClose === 'function') file.doClose();
    else if (file && typeof file.close === 'function') file.close();
  } catch (ignore) {}
}
