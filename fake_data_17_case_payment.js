/**
 * Fake data phuc vu test phan loai 17 case TT-01 ... TT-17.
 * Chi gom 4 bang theo yeu cau:
 *   - esdHTKTpayment
 *   - esdHTKTpaymentVendor
 *   - esdHTKTpaymentInvoice
 *   - esdHTKTinvoice
 *
 * Du lieu tham chieu tu SM:
 *   vendor.id      = 0000000040
 *   vendor.site.id = 0000000222
 *   vendor.number  = NCC_101234523
 *
 * Script chi tao du lieu nguon, KHONG tao esdHTKTpaymentEntry.
 * paymentEntry phai duoc sinh boi action syncPaymentEntry de test dung luong.
 */

var CASES = [
  { code: 'TT-01', approved: 1000000, payment: 1000000, refund: 0,       personal: false, tax: 0 },
  { code: 'TT-02', approved: 1000000, payment: 1000000, refund: 0,       personal: true,  tax: 0 },
  { code: 'TT-03', approved: 1100000, payment: 1100000, refund: 0,       personal: false, tax: 100000 },
  { code: 'TT-04', approved: 1000000, payment: 600000,  refund: 0,       personal: false, tax: 0 },
  { code: 'TT-05', approved: 1000000, payment: 600000,  refund: 0,       personal: true,  tax: 0 },
  { code: 'TT-06', approved: 1100000, payment: 600000,  refund: 0,       personal: false, tax: 100000 },
  { code: 'TT-07', approved: 1000000, payment: 0,       refund: 1000000, personal: false, tax: 0 },
  { code: 'TT-08', approved: 1000000, payment: 600000,  refund: 400000,  personal: false, tax: 0 },
  { code: 'TT-09', approved: 1100000, payment: 600000,  refund: 500000,  personal: false, tax: 100000 },
  { code: 'TT-10', approved: 1000000, payment: 600000,  refund: 400000,  personal: true,  tax: 0 },
  { code: 'TT-11', approved: 1000000, payment: 0,       refund: 400000,  personal: false, tax: 0 },
  { code: 'TT-12', approved: 1100000, payment: 0,       refund: 400000,  personal: false, tax: 100000 },
  { code: 'TT-13', approved: 1000000, payment: 0,       refund: 400000,  personal: true,  tax: 0 },
  { code: 'TT-14', approved: 1000000, payment: 200000,  refund: 300000,  personal: false, tax: 0 },
  { code: 'TT-15', approved: 1100000, payment: 200000,  refund: 300000,  personal: false, tax: 100000 },
  { code: 'TT-16', approved: 1000000, payment: 200000,  refund: 300000,  personal: true,  tax: 0 },
  { code: 'TT-17', approved: 0,       payment: 500000,  refund: 0,       personal: false, tax: 0 }
];

var INVOICE_TEST_YEAR = '26';
var VENDOR_ID = '0000000040';
var VENDOR_SITE_ID = '0000000222';
var VENDOR_TAX_CODE = 'NCC_101234523';

/* Dai ID co dinh cho 17 case: TT.106.26.0100000 ... TT.106.26.1700000. */
var PAYMENT_TEST_BRANCH = '106';
var PAYMENT_TEST_YEAR = '26';

/*
 * false: chi tao va print object.
 * true : xoa bo fake cung ID cu, sau do insert vao SM theo co che all-or-nothing.
 */
var INSERT_TO_SM = true;
var DELETE_EXISTING_17_CASES = true;

/* Fake data khong chay workflow/activity; doAction("add") gay side effect khong rollback duoc. */
var USE_PAYMENT_ACTION_ADD = false;

/*
 * An toan cho SM: moi lan chi insert 1 case (toi da 4 record).
 * Chay lan luot CASE_START_INDEX = 0..16 thay vi insert 66 record trong 1 request.
 */
var CASE_START_INDEX = 0;
var CASE_BATCH_SIZE = 17;

/* Preview va insert deu dung cung ID co dinh theo case. */
var fakeDb;
if (INSERT_TO_SM) {
  try {
    fakeDb = buildFakeDb(true);
    runAtomicFakeInsert(fakeDb);
  } catch (prepareError) {
    try {
      print(JSON.stringify({
        success: false,
        inserted: 0,
        error: 'Khong tao duoc bo fake data: ' + prepareError.toString()
      }));
    } catch (ignorePreparePrint) {}
  }
} else {
  fakeDb = buildFakeDb(false);
  try { print(JSON.stringify(fakeDb)); } catch (ignorePrint) {}
}

function buildFakeDb(useNextNumber) {
  var db = {
    esdHTKTpayment: [],
    esdHTKTpaymentVendor: [],
    esdHTKTpaymentInvoice: [],
    esdHTKTinvoice: []
  };

  var startIndex = Math.max(0, Number(CASE_START_INDEX) || 0);
  var batchSize = Math.max(
    1,
    Math.min(CASES.length, Number(CASE_BATCH_SIZE) || 1)
  );
  var endIndex = Math.min(CASES.length, startIndex + batchSize);

  if (startIndex >= CASES.length) {
    throw new Error('CASE_START_INDEX phai nam trong khoang 0..16.');
  }

  for (var i = startIndex; i < endIndex; i++) {
    var definition = CASES[i];
    var paymentId = makeCasePaymentId(i + 1);
    var invoiceId = makeCaseInvoiceId(i + 1);
	print("invoiceId them moi " + invoiceId)

    db.esdHTKTpayment.push(makePayment(paymentId, definition));
    db.esdHTKTpaymentVendor.push(makePaymentVendor(paymentId, definition));

    // TT-17: khong co hoa don, approved.invoice.amount = 0 va amount > 0.
    if (definition.code !== 'TT-17') {
      db.esdHTKTpaymentInvoice.push(makePaymentInvoice(paymentId, invoiceId, definition));
      db.esdHTKTinvoice.push(makeInvoice(invoiceId, definition));
    }
  }

  return db;
}

function makePayment(paymentId, definition) {
  return {
    id: paymentId,
    department: '099922010',
    description: '',
    'current.phase': 'initial_dmms',
    'user.checker.kttc': '',
    'user.checker.dmms': '',
    'user.approver.dmms': '',
    'user.approver.kttc': '',
    'user.checker.final': '',
    'user.approver.final': '',
    'return.reason': '',
    'initial.role': 'dmms',
    'created.by': 'VTB.HTKT.99',
    'created.at': new Date(),
    'transaction.type': 'Thanh toán',
    status: 'dmms_created',
    'require.check.level1': false,
    'require.check.level2': false,
    'unit.lv1': '099922000',
    'unit.lv2': '099922010',
    'contract.id': 'KMS_2026_009_00090',
    'contract.name': '',
    currency: 'VND',
    'total.contract.amount': 2990906.1,
    'total.advance.amount': definition.refund,
    'total.amount.paid': definition.payment,
    'total.refund.amount': definition.refund,
    '_expected.case': definition.code
  };
}

function makePaymentVendor(paymentId, definition) {
  var caseNumber = parseInt(String(definition.code).replace('TT-', ''), 10) || 0;
  return {
    id: padLeft(9000000 + caseNumber, 14),
    'payment.id': paymentId,
    'vendor.id': VENDOR_ID,
    'vendor.site.id': VENDOR_SITE_ID,
    'approved.invoice.amount': definition.approved,
    amount: definition.payment,
    'refund.amount': definition.refund,
    'vendor.type': definition.personal ? 'CN' : 'DN',
    currency: 'VND',
    'payment.method': 'CHUYENKHOAN',
    'beneficiary.account': '88888888',
    'beneficiary.name': 'CT CTP GIMO',
    'beneficiary.bank': '01202001',
    'bank.name': 'NH TMCP Dau tu va Phat trien Viet Nam (BIDV)',
    'transaction.des': 'Test sinh but toan ' + definition.code +
      ' - ' + (definition.personal ? 'NCC ca nhan' : 'NCC doanh nghiep'),
    'identity.number': '',
    'issued.date': '',
    'issued.place': '',
    phone: '',
    'check.name.success': true,
    'exchange.rate': '',
    'payment.rate': '',
    '_expected.case': definition.code
  };
}

function makePaymentInvoice(paymentId, invoiceId, definition) {
  var vendorType = definition.personal ? 'CN' : 'DN';
  var deductionType;

  // CN: co hoa don de phan case nhung khong sinh thue GTGT tu dong.
  // DN co thue: khau tru toan bo. DN khong thue: khong khau tru.
  if (definition.personal) {
    deductionType = 'KHONG_KHAU_TRU';
  } else {
    deductionType = definition.tax > 0
      ? 'KHAU_TRU_TOAN_BO'
      : 'KHONG_KHAU_TRU';
  }

  return {
    'payment.id': paymentId,
    'invoice.id': invoiceId,
    'deduction.type': deductionType,
    'deduction.amount': vendorType === 'DN' ? definition.tax : 0,
    'deduction.rate': vendorType === 'DN' && definition.tax > 0 ? 100 : 0,
    '_vendor.type': vendorType,
    '_expected.case': definition.code
  };
}

function makeInvoice(invoiceId, definition) {
  var caseNumber = parseInt(String(definition.code).replace('TT-', ''), 10) || 0;
  var invoiceDigits = String(invoiceId).replace(/[^0-9]/g, '');
  var uniqueInvoiceNumber = invoiceDigits.substring(
    Math.max(0, invoiceDigits.length - 8)
  );
  return {
    id: invoiceId,
    'invoice.pattern': definition.personal ? 'FAKE26-CN' : 'FAKE26-DN',
    'invoice.number': uniqueInvoiceNumber,
    'invoice.date': new Date(2026, 0, Math.max(1, Math.min(28, caseNumber))),
    'invoice.serial': (definition.personal ? 'CN' : 'DN') + padLeft(caseNumber, 2),
    'total.tax': definition.personal ? 0 : definition.tax,
    'exchange.rate': 1,
    'seller.tax.code': VENDOR_TAX_CODE,
    '_expected.case': definition.code
  };
}

function padLeft(value, length) {
  var result = String(value);
  while (result.length < length) result = '0' + result;
  return result;
}

function makeCasePaymentId(caseNumber) {
  var sequence = Number(caseNumber) * 100000;
  return 'TT.' + PAYMENT_TEST_BRANCH + '.' + PAYMENT_TEST_YEAR + '.' +
    padLeft(sequence, 7);
}

function makeCaseInvoiceId(caseNumber) {
  var caseText = padLeft(Number(caseNumber), 2);
  var randomText = padLeft(Math.floor(Math.random() * 100000), 5);
  return 'SSVN' + INVOICE_TEST_YEAR + caseText + randomText;
}

/**
 * SM SCFile khong cung cap transaction DB that su trong doan script nay.
 * Vi vay script mo phong transaction:
 *   1. Xoa bo fake cu co dung dai ID cua script.
 *   2. Insert lan luot, bat buoc tung dong RC_SUCCESS.
 *   3. Neu bat ky dong nao loi, rollback toan bo 4 bang theo dung dai ID fake.
 */
function runAtomicFakeInsert(db) {
  var writtenDb = {
    esdHTKTpayment: [],
    esdHTKTpaymentVendor: [],
    esdHTKTpaymentInvoice: [],
    esdHTKTinvoice: []
  };
  var result = {
    success: false,
    inserted: {},
    cleanupBeforeInsert: {},
    rollback: {},
    error: '',
    rollbackErrors: []
  };

  try {
    if (DELETE_EXISTING_17_CASES) {
      result.cleanupBeforeInsert = deleteExistingCaseData(db, result.rollbackErrors);
      if (result.rollbackErrors.length > 0) {
        throw new Error('Xoa du lieu cu cua 17 case bi loi. Dung insert de tranh du lieu nua voi.');
      }
    }

    // Upsert bang cha truoc, bang lien ket sau.
    result.inserted.esdHTKTpayment = insertAllOrThrow(
      'esdHTKTpayment', db.esdHTKTpayment, writtenDb.esdHTKTpayment
    );
    result.inserted.esdHTKTinvoice = insertAllOrThrow(
      'esdHTKTinvoice', db.esdHTKTinvoice, writtenDb.esdHTKTinvoice
    );
    result.inserted.esdHTKTpaymentVendor = insertAllOrThrow(
      'esdHTKTpaymentVendor', db.esdHTKTpaymentVendor, writtenDb.esdHTKTpaymentVendor
    );
    result.inserted.esdHTKTpaymentInvoice = insertAllOrThrow(
      'esdHTKTpaymentInvoice', db.esdHTKTpaymentInvoice, writtenDb.esdHTKTpaymentInvoice
    );
    // Chi khi tat ca record cua case hien tai thanh cong moi giu lai du lieu.
    result.success = true;
  } catch (e) {
    result.error = e.toString();
    result.rollbackErrors = [];
    /* Chi xoa dung cac ID da ghi thanh cong trong luot hien tai. */
    result.rollback = deleteAllFakeData(writtenDb, result.rollbackErrors);
    result.success = false;
  }

  try { print(JSON.stringify(result)); } catch (ignoreResultPrint) {}
  return result;
}

function insertAllOrThrow(tableName, rows, writtenRows) {
  var inserted = 0;

  for (var i = 0; i < rows.length; i++) {
    var rc = insertRecord(tableName, rows[i]);
    if (rc !== RC_SUCCESS) {
      throw new Error(
        'Insert loi tai bang ' + tableName +
        ', dong ' + (i + 1) + '/' + rows.length +
        ', rc=' + rc + ', id=' + getRowIdentity(rows[i])
      );
    }
    writtenRows.push(rows[i]);
    inserted++;
  }

  return inserted;
}

function insertRecord(tableName, row) {
  var file = null;
  try {
    var recordQuery = getRecordQuery(tableName, row);

    /*
     * Tranh duplicate key khi SM chua xoa vat ly record trong cung request.
     * Neu ID fake da ton tai thi update; neu chua co moi insert/add.
     */
    if (recordQuery) {
      file = new SCFile(tableName);
      var findRc = file.doSelect(recordQuery);
      if (findRc === RC_SUCCESS) {
        mapRowToFile(file, row);
        var updateRc = file.doUpdate();
        closeFile(file);
        return updateRc;
      }
      closeFile(file);
      file = null;
    }

    file = new SCFile(tableName);
    mapRowToFile(file, row);
    var rc;
    if (tableName === 'esdHTKTpayment' && USE_PAYMENT_ACTION_ADD) {
      rc = addPaymentByAction(file);
    } else {
      rc = file.doInsert();
    }
    closeFile(file);
    return rc;
  } catch (e) {
    closeFile(file);
    throw new Error(tableName + ' [' + getRowIdentity(row) + ']: ' + e.toString());
  }
}

/**
 * Xoa du lieu cu chi trong pham vi 17 payment ID cua bo test.
 * Invoice duoc xoa theo tung invoice.id doc tu paymentInvoice truoc khi xoa link.
 */
function deleteExistingCaseData(db, errors) {
  var deleted = {
    esdHTKTpaymentInvoice: 0,
    esdHTKTpaymentVendor: 0,
    esdHTKTinvoice: 0,
    esdHTKTpayment: 0
  };
  var invoiceIds = [];
  var invoiceIdMap = {};

  for (var i = 0; i < db.esdHTKTpayment.length; i++) {
    var paymentId = String(db.esdHTKTpayment[i].id);
    var linkedInvoiceIds = getLinkedInvoiceIdsForCleanup(paymentId, errors);

    for (var invoiceIndex = 0; invoiceIndex < linkedInvoiceIds.length; invoiceIndex++) {
      var invoiceId = linkedInvoiceIds[invoiceIndex];
      if (!invoiceIdMap[invoiceId]) {
        invoiceIdMap[invoiceId] = true;
        invoiceIds.push(invoiceId);
      }
    }

    deleted.esdHTKTpaymentInvoice += deleteByQuery(
      'esdHTKTpaymentInvoice',
      'payment.id="' + escapeQueryValue(paymentId) + '"',
      errors
    );
    deleted.esdHTKTpaymentVendor += deleteByQuery(
      'esdHTKTpaymentVendor',
      'payment.id="' + escapeQueryValue(paymentId) + '"',
      errors
    );
    deleted.esdHTKTpayment += deleteByQuery(
      'esdHTKTpayment',
      'id="' + escapeQueryValue(paymentId) + '"',
      errors
    );
  }

  for (var j = 0; j < invoiceIds.length; j++) {
    deleted.esdHTKTinvoice += deleteByQuery(
      'esdHTKTinvoice',
      'id="' + escapeQueryValue(invoiceIds[j]) + '"',
      errors
    );
  }

  return deleted;
}

function getLinkedInvoiceIdsForCleanup(paymentId, errors) {
  var ids = [];
  var seen = {};
  var file = null;
  try {
    file = new SCFile('esdHTKTpaymentInvoice', SCFILE_READONLY);
    var rc = file.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');
    var guard = 0;
    while (rc === RC_SUCCESS && guard < 50) {
      var invoiceId = String(file['invoice.id'] || '');
      if (invoiceId && !seen[invoiceId]) {
        seen[invoiceId] = true;
        ids.push(invoiceId);
      }
      guard++;
      rc = file.getNext();
    }
    if (guard >= 50 && rc === RC_SUCCESS) {
      errors.push('Qua 50 invoice link tai payment.id=' + paymentId + '; dung cleanup an toan.');
    }
  } catch (e) {
    errors.push('Doc invoice link cua ' + paymentId + ': ' + e.toString());
  }
  closeFile(file);
  return ids;
}

function getRecordQuery(tableName, row) {
  if (tableName === 'esdHTKTpaymentInvoice') {
    return 'payment.id="' + escapeQueryValue(row['payment.id']) +
      '" and invoice.id="' + escapeQueryValue(row['invoice.id']) + '"';
  }

  if (row.id) {
    return 'id="' + escapeQueryValue(row.id) + '"';
  }

  return '';
}

function mapRowToFile(file, row) {
  for (var key in row) {
    if (!row.hasOwnProperty(key)) continue;
    // Field bat dau bang _ chi la metadata test, khong ghi vao SM.
    if (key.charAt(0) === '_') continue;
    file[key] = row[key];
  }
}

/** Xoa theo ID fake xac dinh, khong xoa du lieu that ngoai bo test. */
function deleteAllFakeData(db, errors) {
  var deleted = {
    esdHTKTpaymentInvoice: 0,
    esdHTKTpaymentVendor: 0,
    esdHTKTinvoice: 0,
    esdHTKTpayment: 0
  };

  // Xoa chinh xac cac ID bang con da ghi, khong xoa theo payment.id rong.
  for (var piIndex = 0; piIndex < db.esdHTKTpaymentInvoice.length; piIndex++) {
    var paymentInvoiceRow = db.esdHTKTpaymentInvoice[piIndex];
    deleted.esdHTKTpaymentInvoice += deleteByQuery(
      'esdHTKTpaymentInvoice',
      'payment.id="' + escapeQueryValue(paymentInvoiceRow['payment.id']) +
        '" and invoice.id="' + escapeQueryValue(paymentInvoiceRow['invoice.id']) + '"',
      errors
    );
  }

  for (var pvIndex = 0; pvIndex < db.esdHTKTpaymentVendor.length; pvIndex++) {
    deleted.esdHTKTpaymentVendor += deleteByQuery(
      'esdHTKTpaymentVendor',
      'id="' + escapeQueryValue(db.esdHTKTpaymentVendor[pvIndex].id) + '"',
      errors
    );
  }

  for (var i = 0; i < db.esdHTKTpayment.length; i++) {
    var paymentId = db.esdHTKTpayment[i].id;
    deleted.esdHTKTpayment += deleteByQuery(
      'esdHTKTpayment',
      'id="' + escapeQueryValue(paymentId) + '"',
      errors
    );
  }

  for (var invoiceIndex = 0; invoiceIndex < db.esdHTKTinvoice.length; invoiceIndex++) {
    deleted.esdHTKTinvoice += deleteByQuery(
      'esdHTKTinvoice',
      'id="' + escapeQueryValue(db.esdHTKTinvoice[invoiceIndex].id) + '"',
      errors
    );
  }

  return deleted;
}

function deleteByQuery(tableName, query, errors) {
  var deleted = 0;
  var maxDeletePerQuery = 10;

  /*
   * Khong dung doDelete() roi getNext() tren cung cursor.
   * Mot so ban SM giu cursor tai record vua xoa va gay lap vo han.
   * Moi vong mo/query lai; neu khong con record thi dung ngay.
   */
  for (var attempt = 0; attempt < maxDeletePerQuery; attempt++) {
    var file = null;
    try {
      file = new SCFile(tableName);
      var selectRc = file.doSelect(query);

      if (selectRc !== RC_SUCCESS) {
        closeFile(file);
        return deleted;
      }

      var deleteRc = file.doDelete();
      closeFile(file);

      if (deleteRc !== RC_SUCCESS) {
        errors.push(tableName + ' [' + query + '] delete rc=' + deleteRc);
        return deleted;
      }

      deleted++;
    } catch (e) {
      closeFile(file);
      errors.push(tableName + ' [' + query + ']: ' + e.toString());
      return deleted;
    }
  }

  errors.push(
    tableName + ' [' + query +
    ']: vuot qua gioi han xoa ' + maxDeletePerQuery + ' record; da dung de tranh lap vo han.'
  );
  return deleted;
}

function getRowIdentity(row) {
  return String(
    row.id || row['payment.id'] || row['invoice.id'] || 'unknown'
  );
}

/**
 * Luu payment dung logic nghiep vu duoc cung cap: doAction("add") va tam tat
 * auto payment activity de khong sinh activity trung trong bo fake data.
 */
function addPaymentByAction(paymentFile) {
  var previousSkip = '';
  try {
    previousSkip = vars['$L.skipAutoPaymentActivity'];
  } catch (ignoreReadSkip) {}

  try {
    vars['$L.skipAutoPaymentActivity'] = 'true';
    return paymentFile.doAction('add');
  } finally {
    try { vars['$L.skipAutoPaymentActivity'] = previousSkip; } catch (ignoreRestoreSkip) {}
  }
}

function escapeQueryValue(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function closeFile(file) {
  try { if (file) file.doClose(); } catch (ignoreClose) {}
}
