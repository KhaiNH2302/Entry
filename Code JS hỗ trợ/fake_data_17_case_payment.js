/**
 * Fake data phuc vu test phan loai 17 case TT-01 ... TT-17.
 * Chi gom 4 bang theo yeu cau:
 *   - esdHTKTpayment
 *   - esdHTKTpaymentVendor
 *   - esdHTKTpaymentInvoice
 *   - esdHTKTinvoice
 *
 * Du lieu tham chieu tu SM:
 * Moi case tao 2 payment de doi chieu ket qua sinh but toan:
 *   - payment thu 1: 1 nha cung cap
 *   - payment thu 2: 2 nha cung cap (chia tien 60/40)
 * Dung cac cap vendor/site co that tren SM:
 *   - 0000000040 / 0000000222 / NCC_101234523
 *   - 0000000041 / 0000000206 / NCC_101234504
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

/*
 * Phan loai NCC bat buoc cua 17 case:
 *   CN: TT-02, TT-05, TT-10, TT-13, TT-16
 *   DN: cac case con lai
 * Ca payment don NCC va payment nhieu NCC phai giu cung loai NCC cua case.
 */
var PERSONAL_CASES = {
  'TT-02': true,
  'TT-05': true,
  'TT-10': true,
  'TT-13': true,
  'TT-16': true
};

var INVOICE_TEST_YEAR = '26';
var VENDORS = [
  {
    id: '0000000040',
    siteId: '0000000222',
    taxCode: 'NCC_101234523',
    beneficiaryAccount: '88888888'
  },
  {
    id: '0000000041',
    siteId: '0000000206',
    taxCode: 'NCC_101234504',
    beneficiaryAccount: '32424234'
  }
];

/*
 * Dai ID co dinh cho 17 case:
 *   - don NCC : TT.106.26.0100000 ... TT.106.26.1700000
 *   - nhieu NCC: TT.106.26.0100001 ... TT.106.26.1700001
 */
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
 * An toan cho SM: co the gioi han so case moi lan bang CASE_BATCH_SIZE.
 * Moi case tao 2 payment: 1 payment don NCC va 1 payment nhieu NCC.
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
  validateCaseVendorTypes();

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
    var paymentVariants = [
      { vendorDefinitions: [definition] },
      { vendorDefinitions: splitDefinitionByVendors(definition) }
    ];

    for (var variantIndex = 0; variantIndex < paymentVariants.length; variantIndex++) {
      var paymentId = makeCasePaymentId(i + 1, variantIndex);
      var variant = paymentVariants[variantIndex];
      db.esdHTKTpayment.push(makePayment(paymentId, definition));

      for (var vendorIndex = 0; vendorIndex < variant.vendorDefinitions.length; vendorIndex++) {
        var vendor = VENDORS[vendorIndex];
        var vendorDefinition = variant.vendorDefinitions[vendorIndex];
        db.esdHTKTpaymentVendor.push(
          makePaymentVendor(
            paymentId, vendorDefinition, vendor, vendorIndex, variantIndex
          )
        );

        // TT-17: khong co hoa don, approved.invoice.amount = 0 va amount > 0.
        if (definition.code !== 'TT-17') {
          var invoiceId = makeCaseInvoiceId(
            i + 1, variantIndex + 1, vendorIndex + 1
          );
          db.esdHTKTpaymentInvoice.push(
            makePaymentInvoice(paymentId, invoiceId, vendorDefinition)
          );
          db.esdHTKTinvoice.push(
            makeInvoice(invoiceId, vendorDefinition, vendor)
          );
        }
      }
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

function makePaymentVendor(paymentId, definition, vendor, vendorIndex, variantIndex) {
  var caseNumber = parseInt(String(definition.code).replace('TT-', ''), 10) || 0;
  var vendorType = getCaseVendorType(definition);
  return {
    id: padLeft(
      900000000 + (caseNumber * 100) + (variantIndex * 10) + vendorIndex + 1,
      14
    ),
    'payment.id': paymentId,
    'vendor.id': vendor.id,
    'vendor.site.id': vendor.siteId,
    'approved.invoice.amount': definition.approved,
    amount: definition.payment,
    'refund.amount': definition.refund,
    'vendor.type': vendorType,
    currency: 'VND',
    'payment.method': 'CHUYENKHOAN',
    'beneficiary.account': vendor.beneficiaryAccount,
    'beneficiary.name': 'CT CTP GIMO',
    'beneficiary.bank': '01202001',
    'bank.name': 'NH TMCP Dau tu va Phat trien Viet Nam (BIDV)',
    'transaction.des': 'Test sinh but toan ' + definition.code +
      ' - ' + (vendorType === 'CN' ? 'NCC ca nhan' : 'NCC doanh nghiep'),
    'identity.number': '',
    'issued.place': '',
    phone: '',
    'check.name.success': true,
    '_expected.case': definition.code,
    '_expected.vendor.type': vendorType
  };
}

function makePaymentInvoice(paymentId, invoiceId, definition) {
  var vendorType = getCaseVendorType(definition);
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

function makeInvoice(invoiceId, definition, vendor) {
  var caseNumber = parseInt(String(definition.code).replace('TT-', ''), 10) || 0;
  var vendorType = getCaseVendorType(definition);
  var invoiceDigits = String(invoiceId).replace(/[^0-9]/g, '');
  var uniqueInvoiceNumber = invoiceDigits.substring(
    Math.max(0, invoiceDigits.length - 8)
  );
  return {
    id: invoiceId,
    'invoice.pattern': vendorType === 'CN' ? 'FAKE26-CN' : 'FAKE26-DN',
    'invoice.number': uniqueInvoiceNumber,
    'invoice.date': new Date(2026, 0, Math.max(1, Math.min(28, caseNumber))),
    'invoice.serial': vendorType + padLeft(caseNumber, 2),
    'total.tax': vendorType === 'CN' ? 0 : definition.tax,
    'exchange.rate': 1,
    'seller.tax.code': vendor.taxCode,
    '_expected.case': definition.code,
    '_expected.vendor.type': vendorType
  };
}

function getCaseVendorType(definition) {
  return definition.personal ? 'CN' : 'DN';
}

/** Chan script ngay neu cau hinh personal bi sua sai so voi ma tran 17 case. */
function validateCaseVendorTypes() {
  for (var i = 0; i < CASES.length; i++) {
    var definition = CASES[i];
    var expectedPersonal = PERSONAL_CASES[definition.code] === true;
    if (definition.personal !== expectedPersonal) {
      throw new Error(
        definition.code + ': vendor.type phai la ' +
        (expectedPersonal ? 'CN' : 'DN')
      );
    }
  }
}

function padLeft(value, length) {
  var result = String(value);
  while (result.length < length) result = '0' + result;
  return result;
}

function makeCasePaymentId(caseNumber, variantIndex) {
  var sequence = (Number(caseNumber) * 100000) + (Number(variantIndex) || 0);
  return 'TT.' + PAYMENT_TEST_BRANCH + '.' + PAYMENT_TEST_YEAR + '.' +
    padLeft(sequence, 7);
}

function makeCaseInvoiceId(caseNumber, variantNumber, vendorNumber) {
  var caseText = padLeft(Number(caseNumber), 2);
  var variantText = String(Number(variantNumber));
  var vendorText = padLeft(Number(vendorNumber), 2);
  var randomText = padLeft(Math.floor(Math.random() * 100), 2);
  return 'SSVN' + INVOICE_TEST_YEAR + caseText + variantText + vendorText + randomText;
}

/** Chia so tien 60/40; phan du duoc giu o NCC dau de tong khong thay doi. */
function splitDefinitionByVendors(definition) {
  var first = {};
  var second = {};
  var fields = ['approved', 'payment', 'refund', 'tax'];

  for (var key in definition) {
    if (!definition.hasOwnProperty(key)) continue;
    first[key] = definition[key];
    second[key] = definition[key];
  }

  for (var i = 0; i < fields.length; i++) {
    var field = fields[i];
    var total = Number(definition[field]) || 0;
    var secondAmount = Math.floor(total * 40 / 100);
    first[field] = total - secondAmount;
    second[field] = secondAmount;
  }

  return [first, second];
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
        mapRowToFile(file, row, tableName);
        var updateRc = file.doUpdate();
        closeFile(file);
        return updateRc;
      }
      closeFile(file);
      file = null;
    }

    file = new SCFile(tableName);
    mapRowToFile(file, row, tableName);
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

function mapRowToFile(file, row, tableName) {
  for (var key in row) {
    if (!row.hasOwnProperty(key)) continue;
    // Field bat dau bang _ chi la metadata test, khong ghi vao SM.
    if (key.charAt(0) === '_') continue;
    try {
      file[key] = row[key];
    } catch (e) {
      throw new Error(
        tableName + '.' + key +
        ' khong nhan gia tri [' + String(row[key]) +
        '] (' + typeof row[key] + '): ' + e.toString()
      );
    }
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
