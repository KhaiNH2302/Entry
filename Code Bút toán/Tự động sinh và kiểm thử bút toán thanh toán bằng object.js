/**
 * BẢN CLONE PHỤC VỤ CODE/TEST BẰNG OBJECT.
 *
 * File gốc:
 *   Tự động sinh và đồng bộ bút toán thanh toán trong esdHTKTpaymentEntry.js
 *
 * Bản này giữ nguyên luồng production, đồng thời bổ sung action
 * testPaymentEntryObjects để truyền dữ liệu các bảng dưới dạng object,
 * không đọc/ghi DB khi chạy test sinh bút toán.
 */

/*
 * ===========================================================================
 *  TODO CÒN LẠI
 * ---------------------------------------------------------------------------
 *  TT-17 ĐÃ CHỐT:
 *    - Khoản treo TT-BK-07 bằng số tiền thanh toán; tự sinh cặp
 *      Nợ TK Phải trả / Có TK Khách hàng.
 *
 *  TODO-INTEGRATION:
 *    - Fill payload Invoice/AP, Apply Prepayment, Payment, GL và Core Banking.
 *    - Hiện tại chưa gọi hoặc gửi dữ liệu sang hệ thống tích hợp.
 *
 *  ĐÃ CHỐT TẠM:
 *    - Dòng CUSTOMER thanh toán Tiền mặt dùng cố định STK 99999999.
 *    - Dòng CUSTOMER Chuyển khoản lấy paymentVendor.beneficiary.account.
 *
 *  ĐÃ CHỐT TRONG CODE:
 *    - (1) approved.invoice.amount; (2) amount; (3) refund.amount.
 *    - refund.amount chỉ dùng phân case có tạm ứng; chưa dùng để sinh dòng
 *      Có TK tạm ứng hoặc giảm công nợ trong paymentEntry.
 *    - TK phải trả NCC = vendorSite.credit.account.
 *    - TK tạm ứng khi hoàn ứng = vendorSite.debit.account.
 *    - Cost Division lọc theo payment.id và vendor.id.
 *    - Invoice/thuế = Standard; hoàn ứng = ApplyPrepayment; đi tiền = Payment.
 *    - paymentEntry lưu theo phần "Hiển thị tại tab Hạch toán": đã khử TK phải trả.
 *    - NCC cá nhân: sinh tài khoản, amount=null để KT nhập; Có Tạm ứng giữ (3).
 * ===========================================================================
 */

/*
 * ===========================================================================
 *  SƠ ĐỒ LUỒNG CODE
 * ---------------------------------------------------------------------------
 *  01. ENTRY POINT
 *      run() nhận action và chuyển đến đúng chức năng.
 *
 *  02. LOAD / SYNC
 *      Đọc bút toán đã lưu -> sinh bộ bút toán mong đợi -> merge dữ liệu
 *      được phép sửa -> validate -> lưu lại DB.
 *
 *  03. SAVE CHỈNH SỬA
 *      Nhận danh sách người dùng sửa -> normalize -> validate cân đối -> save.
 *
 *  04. PHÂN CASE
 *      Đọc (1), (2), (3), thuế và loại NCC -> classifyPaymentCase().
 *
 *  05. SINH BÚT TOÁN
 *      Dispatch đến hàm TT-01 ... TT-17 -> buildStandardPaymentCase().
 *
 *  06. VALIDATE
 *      Kiểm tra tài khoản, số tiền và các trường DB bắt buộc.
 *
 *  07. PERSISTENCE / SAVE DB
 *      Xóa bút toán tự động cũ -> insert bộ bút toán mới.
 *
 *  08. INTEGRATION
 *      Chỉ có khung hàm payload; hiện chưa gọi hệ thống ngoài.
 * ===========================================================================
 */

// =============================================================================
// SECTION 01 - ENTRY POINT: nhận action và điều phối luồng xử lý
// =============================================================================

function run() {
  try {
    var input = vars['$L.file'];
    if (!input) return;

    var action = input.name || '';
    var details = getInputDetails(input);
    var result;
    debugPaymentEntry('RUN', 'Bắt đầu action=' + action + ', paymentId=' + safeString(details.paymentId));

    // danh sach hach toan
    if (action === 'getListPaymentEntry') {
      result = getListPaymentEntryByInputDetails(details);
    // sinh but toan tu dong
    } else if (action === 'syncPaymentEntry') {
      result = syncPaymentEntryNowByInputDetails(details);
    // sinh but toan tu dong khi nguon sinh thay doi
    } else if (action === 'syncPaymentEntryBySourceChange') {
      result = syncPaymentEntryBySourceChange(safeString(details.sourceTable || input.sourceTable).trim(), details);
    // luu chinh sua
    } else if (action === 'savePaymentEntryEdit') {
      result = savePaymentEntryEdit(details);
    // lay tai khoan GL
    } else if (action === 'getListGLAccount') {
      result = getListGlAccount();
    // kiểm thử thuần bằng object, không đọc/ghi DB
    } else if (action === 'testPaymentEntryObjects') {
      result = testPaymentEntryObjects(details);
    // chạy toàn bộ case đã hoàn thành và trả báo cáo text theo tài liệu nghiệp vụ
    } else if (action === 'runCompletedPaymentCaseTests') {
      result = runCompletedPaymentCaseTests();
    } else {
      result = { success: false, error: 'Invalid action: ' + action };
    }

    debugPaymentEntry('RUN', 'Kết thúc action=' + action + ', mode=' + safeString(result && result.mode) + ', success=' + safeString(result && result.success));
    input.queryReturn =
      action === 'runCompletedPaymentCaseTests'
        ? result.output
        : JSON.stringify(result);
  } catch (e) {
    debugPaymentEntry('RUN-ERROR', e.toString());
    if (vars['$L.file']) {
      vars['$L.file'].queryReturn = JSON.stringify({
        success: false,
        error: 'Gateway Error: ' + e.toString()
      });
    }
  }
}

function debugPaymentEntry(point, message) {
  try {
    if (typeof print === 'function') {
      print('[PAYMENT-ENTRY][' + safeString(point) + '] ' + safeString(message));
    }
  } catch (ignore) {}
}

// =============================================================================
// SUPPORT - CONSTANTS: bảng DB, mã bút toán, mã case và loại tài khoản
// =============================================================================

var TABLE_PAYMENT_ENTRY = 'esdHTKTpaymentEntry';             // Bảng chứa dòng bút toán thanh toán
var TABLE_PAYMENT = 'esdHTKTpayment';                         // Bảng đơn thanh toán chính
var TABLE_PAYMENT_VENDOR = 'esdHTKTpaymentVendor';           // Bảng NCC đính kèm trong đơn thanh toán
var TABLE_PAYMENT_INVOICE = 'esdHTKTpaymentInvoice';         // Bảng hóa đơn đính kèm đơn thanh toán
var TABLE_COST_DIVISION = 'esdHTKTpaymentCostDivision';       // Bảng phân bổ chi phí (chỉ có ở thanh toán)
var TABLE_INVOICE = 'esdHTKTinvoice';                         // Bảng thông tin hóa đơn (dùng chung)
var TABLE_VENDOR = 'esdHTKTvendor';                           // Bảng danh mục Nhà cung cấp (dùng chung)
var TABLE_VENDOR_SITE = 'esdHTKTvendorSite';                 // Bảng danh mục Địa điểm NCC (dùng chung)
var TABLE_CATEGORY_ITEM = 'esdDMcategoryItems';               // Bảng thành phần danh mục (dùng chung)
var TABLE_GL_ACCOUNT = 'esdDMglAccount';                      // Bảng danh mục tài khoản GL (dùng chung)
var TABLE_CONTACT = 'contacts';
var TABLE_ENTITY = 'esdDMentity';

// Chỉ có giá trị trong phạm vi action testPaymentEntryObjects.
var PAYMENT_OBJECT_DATABASE = null;

var TYPE = {
  AP: 'AP',
  GL: 'GL'
};

var AUTO_ENTRY_CODE = {
  COST:      'TT-BK-01',   // Ghi nhận chi phí        (Nợ)
  TAX:       'TT-BK-02',   // Thuế GTGT               (Nợ)
  LIABILITY: 'TT-BK-03',   // Ghi nhận nghĩa vụ TT    (Có)
  REFUND_DR: 'TT-BK-04',   // Hoàn ứng                (Nợ)
  REFUND_CR: 'TT-BK-05',   // Giảm dư tạm ứng         (Có)
  PAYMENT:   'TT-BK-06',   // Thanh toán              (Nợ)
  SUSPENDED: 'TT-BK-07',   // Trả khoản treo          (Nợ)
  TRANSFER:  'TT-BK-08'    // Chuyển tiền             (Có)
};

var PAYMENT_CASE = {
  TT01: 'TT-01', TT02: 'TT-02', TT03: 'TT-03', TT04: 'TT-04',
  TT05: 'TT-05', TT06: 'TT-06', TT07: 'TT-07', TT08: 'TT-08',
  TT09: 'TT-09', TT10: 'TT-10', TT11: 'TT-11', TT12: 'TT-12',
  TT13: 'TT-13', TT14: 'TT-14', TT15: 'TT-15', TT16: 'TT-16',
  TT17: 'TT-17'
};

// Dùng khi so sánh số tiền để tránh sai số kiểu Number.
var MONEY_EPSILON = 0.001;

var LEDGER_TYPE = {
  STANDARD: 'Standard'
};

var ACCOUNT_TYPE = {
  DEBIT: 'DEBIT',
  ASSET: 'ASSET'
};

var ENTRY_TYPE = {
  COST: 'COST',
  PREPAYMENT: 'PREPAYMENT',
  TAX: 'TAX',
  PAYABLE: 'PAYABLE',
  CUSTOMER: 'CUSTOMER'
};

var GENERATION_PHASE = {
  DMMS: 'initial_dmms',
  KTTC: 'initial_kttc'
};

var CATEGORY_TAX_ACCOUNT_NUMBER = 'htkt_loai_khau_tru';
var CATEGORY_TAX_DEDUCTION_TYPE = 'dmhd_loai_khau_tru';
var DEDUCTION_TYPE_FULL = 'KHAU_TRU_TOAN_BO';
var DEDUCTION_TYPE_RATE = 'KHAU_TRU_TY_LE';
var DEDUCTION_TYPE_NONE = 'KHONG_KHAU_TRU';
var GL_UNIT_TRANSACTION_CODE = '98';
var CASH_CUSTOMER_ACCOUNT_NUMBER = '99999999';
var CASH_CUSTOMER_ACCOUNT_NAME = 'Tài khoản tiền mặt';

// =============================================================================
// SECTION 02 - LOAD / SYNC: đọc, sinh lại, merge, validate và lưu tự động
// =============================================================================

/** Chỉ lấy bút toán đã lưu; việc sinh mới được thực hiện qua action syncPaymentEntry. */
function getListPaymentEntryByInputDetails(details) {
  var paymentId = safeString(details.paymentId).trim();
  debugPaymentEntry('GET-LIST', 'Bắt đầu paymentId=' + paymentId);

  if (!paymentId) {
    return makeResult([], 'empty', {
      canGenerate: false,
      message: 'Thiếu mã đề nghị thanh toán.',
      errors: ['Thiếu mã đề nghị thanh toán.']
    });
  }

  var request = getPaymentRequest(paymentId);
  var currentPhase = request.current_phase;
  var userCheckerKttc = request.user_checker_kttc;
  var savedEntries = getSavedPaymentEntries(paymentId);
  debugPaymentEntry('GET-LIST', 'Đã đọc ' + savedEntries.length + ' dòng đã lưu, phase=' + currentPhase);

  // Entry đã có thì trả ngay; dữ liệu nguồn được kiểm tra khi trigger gọi sinh lại.
  if (savedEntries.length > 0) {
    debugPaymentEntry('GET-LIST', 'Trả dữ liệu đã lưu, không sinh lại');
    return makeResult(savedEntries, 'saved', {
      currentPhase: currentPhase,
      userCheckerKttc: userCheckerKttc
    });
  }

  if (isGenerationPhaseLocked(currentPhase)) {
    debugPaymentEntry('GET-LIST', 'Không có dữ liệu và phase đang khóa');
    return makeResult([], 'empty', {
      locked: true,
      currentPhase: currentPhase,
      userCheckerKttc: userCheckerKttc
    });
  }

  debugPaymentEntry('GET-LIST', 'Không có dữ liệu, trả empty và không tự động sinh');
  return makeResult([], 'empty', {
    currentPhase: currentPhase,
    userCheckerKttc: userCheckerKttc
  });
}

/** Tính lại dữ liệu nguồn, giữ trường được sửa và đồng bộ entry khi chưa khóa. */
function syncPaymentEntryNowByInputDetails(details) {
  var paymentId = safeString(details.paymentId).trim();
  var vendorId = safeString(details.vendorId).trim();
  debugPaymentEntry('SYNC', 'Bắt đầu paymentId=' + paymentId + ', vendorId=' + vendorId);

  if (!paymentId) {
    return makeResult([], 'empty', {
      canGenerate: false,
      message: 'Thiếu mã đề nghị thanh toán.',
      errors: ['Thiếu mã đề nghị thanh toán.']
    });
  }

  var savedEntries = getSavedPaymentEntries(paymentId);
  var expectedResult = buildExpectedPaymentEntries(paymentId, vendorId);
  var expectedEntries = expectedResult.rows;
  var canGenerate = expectedResult.canGenerate;
  var generationErrors = expectedResult.errors || [];
  var successfulVendorIds = expectedResult.successfulVendorIds || [];
  var hasPartialSuccess = successfulVendorIds.length > 0;
  debugPaymentEntry('SYNC', 'Build xong: rows=' + expectedEntries.length + ', NCC thành công=' + successfulVendorIds.length + ', errors=' + generationErrors.length);

  // Chỉ giữ nguyên toàn bộ CSDL khi không có NCC nào sinh thành công.
  if (!canGenerate && !hasPartialSuccess) {
    debugPaymentEntry('SYNC', 'Không có NCC nào thành công, giữ nguyên CSDL');
    return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', makeGenerationErrorMeta(generationErrors));
  }

  // NCC lỗi giữ nguyên bút toán đã lưu; chỉ NCC thành công được thay bằng kết quả mới.
  if (hasPartialSuccess) {
    debugPaymentEntry('SYNC', 'Giữ bút toán cũ của NCC lỗi và thay bút toán NCC thành công');
    expectedEntries = expectedEntries.concat(
      getPreservedAutoEntriesForOtherVendors(savedEntries, successfulVendorIds)
    );
  }

  if (isGenerationPhaseLocked(expectedResult.currentPhase)) {
    debugPaymentEntry('SYNC', 'Dừng do phase đang khóa: ' + expectedResult.currentPhase);
    return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', {
      locked: true,
      currentPhase: expectedResult.currentPhase
    });
  }

  // NCC cuối cùng đã bị xóa: xóa bút toán AP tự sinh, giữ nguyên bút toán GL bổ sung.
  if (expectedEntries.length === 0) {
    var cleared = replaceAutoPaymentEntries(paymentId, []);

    return makeResult(getSavedPaymentEntries(paymentId), 'synced', { sync: cleared });
  }

  // Lần đầu tiên sinh bút toán (DB rỗng) -> Chèn mới hoàn toàn
  if (savedEntries.length === 0) {
    assignNewEntryIds(paymentId, expectedEntries, savedEntries);
    var inserted = insertPaymentEntries(expectedEntries);

    return makeResult(getSavedPaymentEntries(paymentId), 'generated', {
      canGenerate: canGenerate,
      partial: !canGenerate,
      errors: generationErrors,
      sync: {
        inserted: inserted,
        updated: 0,
        deleted: 0
      }
    });
  }

  // Gộp thông tin người dùng đã chỉnh sửa trên UI (description, account_number) vào bút toán mới
  var mergedExpectedEntries = mergeEditableAutoEntryFields(savedEntries, expectedEntries);
  assignNewEntryIds(paymentId, mergedExpectedEntries, savedEntries);

  // Tiến hành xóa bút toán cũ và chèn lại bộ bút toán đã merge mới
  var syncResult = replaceAutoPaymentEntries(paymentId, mergedExpectedEntries);

  return makeResult(getSavedPaymentEntries(paymentId), 'synced', {
    canGenerate: canGenerate,
    partial: !canGenerate,
    errors: generationErrors,
    sync: syncResult
  });
}

function getPreservedAutoEntriesForOtherVendors(savedEntries, successfulVendorIds) {
  var successfulMap = {};
  var result = [];

  for (var i = 0; i < successfulVendorIds.length; i++) {
    successfulMap[safeString(successfulVendorIds[i]).trim()] = true;
  }

  for (var j = 0; j < savedEntries.length; j++) {
    var saved = savedEntries[j];
    if (!isAutoEntry(saved)) continue;
    if (successfulMap[safeString(saved.vendor_id).trim()]) continue;
    result.push(copyObject({}, saved));
  }

  return result;
}

// -----------------------------------------------------------------------------
// SECTION 02A - SOURCE CHANGE: xác định phiếu bị ảnh hưởng và gọi LOAD / SYNC
// -----------------------------------------------------------------------------

/** Đồng bộ các đề nghị chịu ảnh hưởng sau khi bản ghi nguồn được lưu. */
function syncPaymentEntryBySourceChange(sourceTable, sourceRecord) {
  var source = sourceRecord || {};

  var paymentIds = resolvePaymentIdsFromSourceChange(sourceTable, source);
  var results = [];
  var errors = [];

  // Duyệt qua tất cả các mã đơn thanh toán bị ảnh hưởng để đồng bộ lại
  for (var i = 0; i < paymentIds.length; i++) {
    var syncResult = syncPaymentEntryNowByInputDetails({
      paymentId: paymentIds[i],
      vendorId: ''
    });

    results.push(syncResult);

    if (syncResult.canGenerate === false) {
      var syncErrors = syncResult.errors || [];
      if (syncErrors.length > 0) {
        for (var errorIndex = 0; errorIndex < syncErrors.length; errorIndex++) {
          errors.push(paymentIds[i] + ': ' + syncErrors[errorIndex]);
        }
      } else if (syncResult.message) {
        errors.push(paymentIds[i] + ': ' + syncResult.message);
      }
    }
  }

  if (paymentIds.length === 0) {
    errors.push('Không xác định được mã đề nghị thanh toán từ dữ liệu nguồn.');
  }

  errors = makeUniqueTextList(errors);

  var response = {
    success: true,
    mode: 'source-change-sync',
    sourceTable: sourceTable || '',
    affectedPaymentIds: paymentIds,
    results: results,
    canGenerate: errors.length === 0
  };

  if (errors.length > 0) {
    response.message = errors.join(' ');
    response.errors = errors;
  }

  return response;
}

/** Tìm các paymentId chịu ảnh hưởng theo bảng nguồn. */
function resolvePaymentIdsFromSourceChange(sourceTable, sourceRecord) {
  var table = normalizeSourceTableName(sourceTable);

  if (table === normalizeSourceTableName(TABLE_PAYMENT)) {
    return makeUniqueTextList([readText(sourceRecord, 'id')]);
  }

  if (table === normalizeSourceTableName(TABLE_PAYMENT_VENDOR)) {
    return makeUniqueTextList([readText(sourceRecord, 'payment.id')]);
  }

  if (table === normalizeSourceTableName(TABLE_PAYMENT_INVOICE)) {
    var directPaymentId = readText(sourceRecord, 'payment.id');
    if (directPaymentId) return makeUniqueTextList([directPaymentId]);

    return getPaymentIdsByInvoiceId(readText(sourceRecord, 'invoice.id'));
  }

  if (table === normalizeSourceTableName(TABLE_COST_DIVISION)) {
    return makeUniqueTextList([readText(sourceRecord, 'payment.id')]);
  }

  if (table === normalizeSourceTableName(TABLE_INVOICE)) {
    return getPaymentIdsByInvoiceId(readText(sourceRecord, 'id'));
  }

  if (table === normalizeSourceTableName(TABLE_VENDOR)) {
    return getPaymentIdsByVendorId(readText(sourceRecord, 'id'));
  }

  if (table === normalizeSourceTableName(TABLE_VENDOR_SITE)) {
    return getPaymentIdsByVendorSite(sourceRecord);
  }

  return [];
}

function normalizeSourceTableName(value) {
  return safeString(value).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function getPaymentIdsByInvoiceId(invoiceId) {
  var safeInvoiceId = safeString(invoiceId);
  if (!safeInvoiceId) return [];

  return getPaymentIdsFromTable(
    TABLE_PAYMENT_INVOICE,
    'invoice.id="' + escapeQueryValue(safeInvoiceId) + '"'
  );
}

function getPaymentIdsByVendorId(vendorId) {
  var safeVendorId = safeString(vendorId).trim();
  if (!safeVendorId) return [];

  return getPaymentIdsFromTable(
    TABLE_PAYMENT_VENDOR,
    'vendor.id="' + escapeQueryValue(safeVendorId) + '"'
  );
}

function getPaymentIdsByVendorSite(sourceRecord) {
  var vendorSiteId = readText(sourceRecord, 'id');
  if (!vendorSiteId) return [];

  return getPaymentIdsFromTable(
    TABLE_PAYMENT_VENDOR,
    'vendor.site.id="' + escapeQueryValue(vendorSiteId) + '"'
  );
}

function getPaymentIdsFromTable(tableName, query) {
  var result = [];
  var f = new SCFile(tableName, SCFILE_READONLY);
  var rc;

  try {
    rc = f.doSelect(query);
  } catch (e) {
    closeFile(f);
    return result;
  }

  while (rc === RC_SUCCESS) {
    result.push(readText(f, 'payment.id'));
    rc = f.getNext();
  }

  closeFile(f);
  return makeUniqueTextList(result);
}

// =============================================================================
// SUPPORT - INPUT / RESPONSE: parse request và chuẩn hóa kết quả trả về UI
// =============================================================================

function getInputDetails(input) {
  var parsed = {};

  copyObject(parsed, parseJsonObject(input.queryString));
  copyObject(parsed, parseJsonObject(input.details));

  if (!parsed.paymentId) parsed.paymentId = input.paymentId || input.id;
  if (!parsed.vendorId && input.vendorId) parsed.vendorId = input.vendorId;
  if (!parsed.entries && input.entries) parsed.entries = input.entries;

  return parsed;
}

function copyObject(target, source) {
  if (!source) return target;

  for (var key in source) {
    if (source.hasOwnProperty(key)) target[key] = source[key];
  }

  return target;
}

function parseJsonObject(value) {
  if (!value) return null;

  try {
    var parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (e) {
    return null;
  }
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return null;

  try {
    var parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch (e) {
    return null;
  }
}

function makeResult(rows, mode, meta) {
  var data = rows || [];
  var result = {
    success: true,
    mode: mode,
    data: data,
    accountingItems: mapAccountingTableItems(data)
  };

  if (meta) {
    for (var key in meta) {
      if (meta.hasOwnProperty(key)) result[key] = meta[key];
    }
  }

  return result;
}

function makeError(message) {
  return {
    success: false,
    error: message
  };
}

function makeGenerationErrorMeta(errors) {
  var uniqueErrors = makeUniqueTextList(errors || []);

  return {
    canGenerate: false,
    message: uniqueErrors.length > 0 ? uniqueErrors.join(' ') : 'Không đủ dữ liệu để sinh bút toán.',
    errors: uniqueErrors
  };
}

// =============================================================================
// TEST BẰNG OBJECT: adapter dữ liệu và thống kê số lượng đầu ra
// =============================================================================

/**
 * Input:
 * {
 *   paymentId: "PAYMENT-01",
 *   vendorId: "",
 *   dbObjects: {
 *     esdHTKTpayment: [{ id: "PAYMENT-01", ... }],
 *     esdHTKTpaymentVendor: [{ "payment.id": "PAYMENT-01", ... }],
 *     ...
 *   },
 *   expected: {
 *     caseCodes: ["TT-01"],
 *     totalRows: 2,
 *     countsByEntryCode: { "TT-BK-01": 1, "TT-BK-08": 1 }
 *   }
 * }
 */
function testPaymentEntryObjects(details) {
  var input = details || {};
  var dbObjects = parseJsonObject(input.dbObjects) || input.dbObjects;
  var paymentId = safeString(input.paymentId).trim();
  var vendorId = safeString(input.vendorId).trim();

  if (!dbObjects || typeof dbObjects !== 'object') {
    return makeError('Thiếu dbObjects phục vụ kiểm thử.');
  }
  if (!paymentId) {
    return makeError('Thiếu paymentId phục vụ kiểm thử.');
  }

  var previousDatabase = PAYMENT_OBJECT_DATABASE;
  var generated;

  try {
    PAYMENT_OBJECT_DATABASE = dbObjects;
    generated = buildExpectedPaymentEntries(paymentId, vendorId);
    // Luồng test gọi trực tiếp hàm build nên phải gán ID giống luồng sync thực tế.
    assignNewEntryIds(paymentId, generated.rows || [], []);
  } finally {
    PAYMENT_OBJECT_DATABASE = previousDatabase;
  }

  var summary = summarizeGeneratedPaymentEntries(generated.rows || [], generated.cases || []);
  var assertions = comparePaymentTestExpectation(summary, input.expected);

  return {
    success: generated.canGenerate && assertions.passed,
    mode: 'object-test',
    canGenerate: generated.canGenerate,
    paymentId: paymentId,
    cases: generated.cases || [],
    data: generated.rows || [],
    accountingItems: mapAccountingTableItems(generated.rows || []),
    summary: summary,
    assertions: assertions,
    errors: generated.errors || []
  };
}

function summarizeGeneratedPaymentEntries(rows, cases) {
  var countsByEntryCode = {};
  var countsByAccountType = {};
  var caseCodes = [];
  var totalAmount = 0;
  var blankAmountRows = 0;

  for (var i = 0; i < rows.length; i++) {
    var entryCode = normalizeEntryType(rows[i].entry_type);
    var accountType = getAccountingSide(rows[i].account_type) || safeString(rows[i].account_type);

    countsByEntryCode[entryCode] = (countsByEntryCode[entryCode] || 0) + 1;
    countsByAccountType[accountType] = (countsByAccountType[accountType] || 0) + 1;
    if (rows[i].amount === null || rows[i].amount === undefined || rows[i].amount === '') {
      blankAmountRows++;
    }
    totalAmount += toNumber(rows[i].amount);
  }

  for (var caseIndex = 0; caseIndex < cases.length; caseIndex++) {
    caseCodes.push(safeString(cases[caseIndex].caseCode));
  }

  return {
    totalRows: rows.length,
    caseCodes: caseCodes,
    countsByEntryCode: countsByEntryCode,
    countsByAccountType: countsByAccountType,
    blankAmountRows: blankAmountRows,
    totalAmount: totalAmount
  };
}

/**
 * Chạy một lần toàn bộ 16 case khởi tạo invoice đã hoàn thành.
 * Output là paymentEntry sau khi đã khử TK phải trả, đúng phần
 * "Hiển thị bút toán tại tab Hạch toán" trong tài liệu nghiệp vụ.
 */
function runCompletedPaymentCaseTests() {
  var definitions = getCompletedPaymentCaseDefinitions();
  var reports = [];
  var results = [];
  var passed = 0;

  reports.push('CHI TIẾT ' + definitions.length + ' CASE SINH BÚT TOÁN THANH TOÁN');
  reports.push('');

  for (var i = 0; i < definitions.length; i++) {
    var definition = definitions[i];
    var testResult = testPaymentEntryObjects({
      paymentId: definition.caseCode,
      dbObjects: createPaymentCaseDbObjects(definition),
      expected: {
        caseCodes: [definition.caseCode],
        totalRows: definition.expectedRows,
        countsByEntryCode: definition.expectedCounts,
        blankAmountRows: definition.expectedBlankRows || 0
      }
    });

    var beneficiaryErrors = getBeneficiaryEntryTypeErrors(testResult.data || []);
    if (beneficiaryErrors.length > 0) {
      testResult.success = false;
      testResult.errors = (testResult.errors || []).concat(beneficiaryErrors);
    }

    results.push(testResult);
    if (testResult.success) passed++;
    reports.push(formatCompletedPaymentCaseOutput(definition, testResult));
  }

  var personalAccountTests = runPersonalCostAccountTests();
  var taxRateTests = runTaxDeductionRateTests();
  reports.push(personalAccountTests.output);
  reports.push(taxRateTests.output);
  reports.push('KẾT QUẢ: ' + passed + '/' + definitions.length + ' case đạt.');
  reports.push(
    'QUY TẮC TK CHI PHÍ CÁ NHÂN: ' +
    personalAccountTests.passed + '/' + personalAccountTests.total + ' test đạt.'
  );
  reports.push(
    'QUY TẮC THUẾ KHẤU TRỪ TỶ LỆ: ' +
    taxRateTests.passed + '/' + taxRateTests.total + ' test đạt.'
  );

  return {
    success: passed === definitions.length && personalAccountTests.success && taxRateTests.success,
    mode: 'completed-case-report',
    passed: passed,
    total: definitions.length,
    output: reports.join('\n'),
    results: results,
    personalAccountTests: personalAccountTests,
    taxRateTests: taxRateTests
  };
}

function runTaxDeductionRateTests() {
  var rates = [0.5, 1.5];
  var expectedTaxes = [50000, 100000];
  var passed = 0;
  var reports = ['KIỂM THỬ THUẾ KHẤU TRỪ THEO EXCHANGE.RATE', ''];
  var results = [];

  for (var i = 0; i < rates.length; i++) {
    var definition = {
      caseCode: 'TT-03-RATE-' + (i + 1),
      approved: 1100000,
      payment: 1100000,
      refund: 0,
      tax: 100000,
      exchangeRate: rates[i]
    };
    var db = createPaymentCaseDbObjects(definition);
    db[TABLE_PAYMENT_INVOICE][0]['deduction.type'] = DEDUCTION_TYPE_RATE;
    db[TABLE_CATEGORY_ITEM].push(
      { 'category.id': CATEGORY_TAX_DEDUCTION_TYPE, 'item.id': DEDUCTION_TYPE_RATE, 'item.name': 'Thuế GTGT khấu trừ tỷ lệ' },
      { 'category.id': CATEGORY_TAX_ACCOUNT_NUMBER, 'item.id': DEDUCTION_TYPE_RATE, 'item.name': '1331' }
    );

    var result = testPaymentEntryObjects({ paymentId: definition.caseCode, dbObjects: db });
    var actualTax = -1;
    for (var rowIndex = 0; rowIndex < result.data.length; rowIndex++) {
      if (normalizeEntryType(result.data[rowIndex].entry_type) === ENTRY_TYPE.TAX) {
        actualTax = toNumber(result.data[rowIndex].amount);
      }
    }

    var testPassed = result.canGenerate && moneyEquals(actualTax, expectedTaxes[i]);
    if (testPassed) passed++;
    results.push(result);
    reports.push(
      'exchange.rate=' + rates[i] + ' => thuế=' + actualTax +
      ', kỳ vọng=' + expectedTaxes[i] + ': ' + (testPassed ? 'ĐẠT' : 'KHÔNG ĐẠT')
    );
  }
  reports.push('');

  return {
    success: passed === rates.length,
    passed: passed,
    total: rates.length,
    output: reports.join('\n'),
    results: results
  };
}

function getBeneficiaryEntryTypeErrors(rows) {
  var errors = [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var entryType = normalizeEntryType(row.entry_type);
    var account = safeString(row.beneficiary_account).trim();
    var name = safeString(row.beneficiary_name).trim();
    var bank = safeString(row.beneficiary_bank).trim();

    if (entryType === ENTRY_TYPE.COST && (account || name !== 'VietinBank' || bank)) {
      errors.push('Dòng COST phải để trống beneficiary_account/beneficiary_bank và beneficiary_name=VietinBank.');
    }
    if (entryType === ENTRY_TYPE.TAX && (account || name || bank)) {
      errors.push('Dòng TAX phải để trống toàn bộ thông tin beneficiary.');
    }
    if (entryType === ENTRY_TYPE.CUSTOMER && isCashPayment(row.payment_method)) {
      if (safeString(row.account_number).trim() !== CASH_CUSTOMER_ACCOUNT_NUMBER) {
        errors.push('Dòng CUSTOMER Tiền mặt phải dùng STK 99999999.');
      }
    } else if (entryType === ENTRY_TYPE.CUSTOMER && (!account || !name || !bank)) {
      errors.push('Dòng CUSTOMER Chuyển khoản phải giữ đủ thông tin beneficiary của NCC.');
    }
  }

  return makeUniqueTextList(errors);
}

function runPersonalCostAccountTests() {
  var definition = {
    caseCode: 'TT-02',
    title: 'Cá nhân',
    personal: true,
    approved: 1000000,
    payment: 1000000,
    refund: 0,
    tax: 0
  };
  var reports = ['KIỂM THỬ QUY TẮC TÀI KHOẢN CHI PHÍ CÁ NHÂN', ''];
  var passed = 0;

  // TH1: 6 dòng PCCP nhưng chỉ có 5 account.number duy nhất.
  var groupedDb = createPaymentCaseDbObjects(definition);
  var baseDivision = groupedDb[TABLE_COST_DIVISION][0];
  var accounts = ['6421', '6422', '6423', '6424', '6425', '6425'];
  groupedDb[TABLE_COST_DIVISION] = [];
  for (var i = 0; i < accounts.length; i++) {
    var division = copyObject({}, baseDivision);
    division.id = 'PCCP-' + (i + 1);
    division['account.number'] = accounts[i];
    division['account.name'] = 'Chi phí ' + accounts[i];
    groupedDb[TABLE_COST_DIVISION].push(division);
    groupedDb[TABLE_GL_ACCOUNT].push({
      account: accounts[i],
      name: 'Chi phí ' + accounts[i],
      'account.type': 'Dư nợ',
      'apply.currency': 'VND'
    });
  }
  var groupedResult = testPaymentEntryObjects({
    paymentId: definition.caseCode,
    dbObjects: groupedDb,
    expected: {
      caseCodes: ['TT-02'],
      totalRows: 6,
      blankAmountRows: 1,
      countsByEntryCode: makeExpectedDisplayCounts(5, 0, 0, 1, 0)
    }
  });
  if (groupedResult.success) passed++;
  reports.push('TH1 - 6 dòng PCCP / 5 tài khoản: ' + (groupedResult.success ? 'ĐẠT' : 'KHÔNG ĐẠT'));

  // TH2: không có PCCP, dùng đúng một dòng vendorSite.debit.account.
  var fallbackDb = createPaymentCaseDbObjects(definition);
  fallbackDb[TABLE_COST_DIVISION] = [];
  var fallbackResult = testPaymentEntryObjects({
    paymentId: definition.caseCode,
    dbObjects: fallbackDb,
    expected: {
      caseCodes: ['TT-02'],
      totalRows: 2,
      blankAmountRows: 2,
      countsByEntryCode: makeExpectedDisplayCounts(1, 0, 0, 1, 0)
    }
  });
  var fallbackAccountOk = false;
  for (var rowIndex = 0; rowIndex < fallbackResult.data.length; rowIndex++) {
    if (normalizeEntryType(fallbackResult.data[rowIndex].entry_type) === ENTRY_TYPE.COST &&
        fallbackResult.data[rowIndex].account_number === '141') {
      fallbackAccountOk = true;
    }
  }
  var fallbackPassed = fallbackResult.success && fallbackAccountOk;
  if (fallbackPassed) passed++;
  reports.push('TH2 - Không PCCP / dùng vendorSite.debit.account: ' + (fallbackPassed ? 'ĐẠT' : 'KHÔNG ĐẠT'));
  reports.push('');

  return {
    success: passed === 2,
    passed: passed,
    total: 2,
    output: reports.join('\n'),
    grouped: groupedResult,
    fallback: fallbackResult
  };
}

function getCompletedPaymentCaseDefinitions() {
  return [
    { caseCode: 'TT-01', title: 'Không hoàn ứng, thanh toán toàn bộ, không thuế', approved: 1000000, payment: 1000000, refund: 0, tax: 0, expectedRows: 2, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 1, 0) },
    { caseCode: 'TT-02', title: 'Cá nhân, thanh toán toàn bộ', personal: true, approved: 1000000, payment: 1000000, refund: 0, tax: 0, expectedRows: 2, expectedBlankRows: 1, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 1, 0) },
    { caseCode: 'TT-03', title: 'Không hoàn ứng, thanh toán toàn bộ, NCC có thuế', approved: 1100000, payment: 1100000, refund: 0, tax: 100000, expectedRows: 3, expectedCounts: makeExpectedDisplayCounts(1, 1, 0, 1, 0) },
    { caseCode: 'TT-04', title: 'Không hoàn ứng, thanh toán một phần, không thuế', approved: 1000000, payment: 600000, refund: 0, tax: 0, expectedRows: 3, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 1, 1) },
    { caseCode: 'TT-05', title: 'Cá nhân, thanh toán một phần, còn phải trả', personal: true, approved: 1000000, payment: 600000, refund: 0, tax: 0, expectedRows: 3, expectedBlankRows: 2, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 1, 1) },
    { caseCode: 'TT-06', title: 'Không hoàn ứng, thanh toán một phần, NCC có thuế', approved: 1100000, payment: 600000, refund: 0, tax: 100000, expectedRows: 4, expectedCounts: makeExpectedDisplayCounts(1, 1, 0, 1, 1) },
    // refund.amount vẫn phân case TT-07..TT-16 nhưng không sinh TT-BK-05 và
    // không giảm công nợ; số hoàn ứng thực tế được xử lý tại tab Công nợ.
    { caseCode: 'TT-07', title: 'Hoàn ứng toàn bộ, không thanh toán thêm', approved: 1000000, payment: 0, refund: 1000000, tax: 0, expectedRows: 2, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 0, 1) },
    { caseCode: 'TT-08', title: 'Hoàn ứng một phần, thanh toán phần còn lại, không thuế', approved: 1000000, payment: 600000, refund: 400000, tax: 0, expectedRows: 3, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 1, 1) },
    { caseCode: 'TT-08', title: 'Kiểm thử giá trị lớn: (1)=100 triệu, (2)=90 triệu, (3)=10 triệu', approved: 100000000, payment: 90000000, refund: 10000000, tax: 0, expectedRows: 3, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 1, 1) },
    { caseCode: 'TT-09', title: 'Hoàn ứng một phần, thanh toán phần còn lại, NCC có thuế', approved: 1100000, payment: 600000, refund: 500000, tax: 100000, expectedRows: 4, expectedCounts: makeExpectedDisplayCounts(1, 1, 0, 1, 1) },
    { caseCode: 'TT-10', title: 'Cá nhân, hoàn ứng và thanh toán hết', personal: true, approved: 1000000, payment: 600000, refund: 400000, tax: 0, expectedRows: 3, expectedBlankRows: 2, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 1, 1) },
    { caseCode: 'TT-11', title: 'Không đi tiền, (1) khác (3), không thuế', approved: 1000000, payment: 0, refund: 1200000, tax: 0, expectedRows: 1, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 0, 0) },
    { caseCode: 'TT-12', title: 'Không đi tiền, (1) khác (3), NCC có thuế', approved: 1100000, payment: 0, refund: 1200000, tax: 100000, expectedRows: 2, expectedCounts: makeExpectedDisplayCounts(1, 1, 0, 0, 0) },
    { caseCode: 'TT-13', title: 'Cá nhân, không đi tiền, (1) khác (3)', personal: true, approved: 1000000, payment: 0, refund: 1200000, tax: 0, expectedRows: 1, expectedBlankRows: 0, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 0, 0) },
    { caseCode: 'TT-14', title: 'Cùng dữ liệu TT-08 nhưng KT thêm AP/PAYABLE', userActionType: 'AP_PAYABLE', approved: 1000000, payment: 600000, refund: 400000, tax: 0, expectedRows: 1, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 0, 0) },
    { caseCode: 'TT-15', title: 'Cùng TT-09 nhưng KT thêm AP/PREPAYMENT; không chặn bởi Vendor Site API', userActionType: 'AP_PREPAYMENT', omitCreditAccount: true, omitVendorSiteCode: true, approved: 1100000, payment: 600000, refund: 500000, tax: 100000, expectedRows: 2, expectedCounts: makeExpectedDisplayCounts(1, 1, 0, 0, 0) },
    { caseCode: 'TT-16', title: 'Cùng dữ liệu TT-10 nhưng KT thêm GL', userActionType: 'GL', personal: true, approved: 1000000, payment: 600000, refund: 400000, tax: 0, expectedRows: 1, expectedBlankRows: 0, expectedCounts: makeExpectedDisplayCounts(1, 0, 0, 0, 0) },
    { caseCode: 'TT-17', title: 'Không có hóa đơn; khoản treo bằng số thanh toán', approved: 0, payment: 600000, refund: 0, tax: 0, expectedRows: 2, expectedCounts: makeExpectedDisplayCounts(0, 0, 0, 1, 1) }
  ];
}

function makeExpectedDisplayCounts(cost, tax, prepayment, transfer, payable) {
  var counts = {};
  counts[ENTRY_TYPE.COST] = cost;
  counts[ENTRY_TYPE.TAX] = tax;
  counts[ENTRY_TYPE.PREPAYMENT] = prepayment;
  counts[ENTRY_TYPE.CUSTOMER] = transfer;
  counts[ENTRY_TYPE.PAYABLE] = payable;
  return counts;
}

function createPaymentCaseDbObjects(definition) {
  var paymentId = definition.caseCode;
  var invoiceId = paymentId + '-INV';
  var vendorId = paymentId + '-VENDOR';
  var vendorSiteId = paymentId + '-SITE';
  var costAmount = definition.approved - definition.tax;
  var objects = {};

  objects[TABLE_PAYMENT] = [{
    id: paymentId,
    department: 'KTTC',
    'current.phase': GENERATION_PHASE.KTTC,
    'user.checker.kttc': 'TESTER',
    currentcy: 'VND'
  }];
  objects[TABLE_PAYMENT_VENDOR] = [{
    id: paymentId + '-PV',
    'payment.id': paymentId,
    'vendor.id': vendorId,
    'vendor.site.id': vendorSiteId,
    'approved.invoice.amount': definition.approved,
    amount: definition.payment,
    'refund.amount': definition.refund,
    'vendor.type': definition.personal ? 'CN' : 'NCC',
    currency: 'VND',
    'payment.method': 'Chuyển khoản',
    'beneficiary.account': '0123456789',
    'beneficiary.name': 'Nhà cung cấp kiểm thử',
    'beneficiary.bank': 'Ngân hàng kiểm thử',
    'exchange.rate': '1',
    'payment.rate': 1
  }];
  objects[TABLE_PAYMENT_INVOICE] = [{
    'payment.id': paymentId,
    'invoice.id': invoiceId,
    'deduction.type': definition.tax > 0 ? DEDUCTION_TYPE_FULL : DEDUCTION_TYPE_NONE,
    'deduction.amount': definition.tax,
    'deduction.rate': definition.tax > 0 ? 10 : 0
  }];
  objects[TABLE_INVOICE] = [{
    id: invoiceId,
    'total.tax': definition.tax,
    'exchange.rate': definition.exchangeRate === undefined ? 1 : definition.exchangeRate,
    'seller.tax.code': '0100000001'
  }];
  objects[TABLE_COST_DIVISION] = [{
    id: paymentId + '-COST-1',
    'payment.id': paymentId,
    'vendor.id': vendorId,
    'account.number': '6428',
    'account.name': 'Chi phí quản lý',
    'amount': costAmount,
    currency: 'VND',
    department: 'KTTC',
    branch: 'HO',
    order: 1
  }];
  objects[TABLE_VENDOR] = [{
    id: vendorId,
    'vendor.name': 'Nhà cung cấp kiểm thử',
    'vendor.number': '0100000001',
    'vendor.type': definition.personal ? 'CN' : 'NCC'
  }];
  objects[TABLE_VENDOR_SITE] = [{
    id: vendorSiteId,
    'vendor.id': vendorId,
    'ogl.site.code': definition.omitVendorSiteCode ? '' : 'TEST_SITE',
    'credit.account': definition.omitCreditAccount ? '' : '331',
    'debit.account': '141'
  }];
  objects[TABLE_CATEGORY_ITEM] = [
    { 'category.id': CATEGORY_TAX_DEDUCTION_TYPE, 'item.id': DEDUCTION_TYPE_FULL, 'item.name': 'Thuế GTGT khấu trừ' },
    { 'category.id': CATEGORY_TAX_ACCOUNT_NUMBER, 'item.id': DEDUCTION_TYPE_FULL, 'item.name': '1331' }
  ];
  objects[TABLE_GL_ACCOUNT] = [
    { account: '331', name: 'Phải trả nhà cung cấp', 'account.type': 'Lưỡng tính', 'apply.currency': 'VND' },
    { account: '141', name: 'Tạm ứng', 'account.type': 'Dư nợ', 'apply.currency': 'VND' },
    { account: '6428', name: 'Chi phí quản lý', 'account.type': 'Dư nợ', 'apply.currency': 'VND' },
    { account: '1331', name: 'Thuế GTGT được khấu trừ', 'account.type': 'Dư nợ', 'apply.currency': 'VND' }
  ];

  var userActionEntry = null;
  if (definition.userActionType === 'AP_PAYABLE') userActionEntry = {
    id: makeUserAddedEntryId(paymentId, 1),
    'payment.id': paymentId,
    'vendor.id': vendorId,
    'entry.type': ENTRY_TYPE.PAYABLE,
    'ledger.type': LEDGER_TYPE.STANDARD,
    'account.type': ACCOUNT_TYPE.ASSET,
    'account.number': '331',
    'account.name': 'Phải trả nhà cung cấp',
    amount: Math.max(1, definition.approved - definition.payment - definition.refund),
    currency: 'VND',
    type: TYPE.AP,
    order: 99
  };
  if (definition.userActionType === 'AP_PREPAYMENT') userActionEntry = {
    id: paymentId + '.PREPAYMENT.1',
    'payment.id': paymentId,
    'vendor.id': vendorId,
    'entry.type': ENTRY_TYPE.PREPAYMENT,
    'account.type': ACCOUNT_TYPE.ASSET,
    amount: definition.refund,
    currency: 'VND',
    type: TYPE.AP,
    order: 99
  };
  if (definition.userActionType === 'GL') userActionEntry = {
    id: makeGlEntryId(paymentId, 1, 1),
    'payment.id': paymentId,
    'vendor.id': vendorId,
    'entry.type': ENTRY_TYPE.PAYABLE,
    'account.type': ACCOUNT_TYPE.ASSET,
    amount: 1,
    currency: 'VND',
    type: TYPE.GL,
    order: 99
  };
  objects[TABLE_PAYMENT_ENTRY] = userActionEntry ? [userActionEntry] : [];

  return objects;
}

function formatCompletedPaymentCaseOutput(definition, testResult) {
  var lines = [];
  var ledgerOrder = [LEDGER_TYPE.STANDARD];
  var ledgerLabels = {};
  var rows = testResult.data || [];

  ledgerLabels[LEDGER_TYPE.STANDARD] = 'AP - Standard:';

  lines.push(definition.caseCode + ': ' + definition.title);
  lines.push(
    '(1) = ' + formatReportMoney(definition.approved) +
    '; (2) = ' + formatReportMoney(definition.payment) +
    '; (3) = ' + formatReportMoney(definition.refund) +
    '; Thuế = ' + formatReportMoney(definition.tax)
  );
  lines.push('');

  if (!testResult.canGenerate) {
    lines.push('KHÔNG SINH ĐƯỢC: ' + (testResult.errors || []).join(' '));
    lines.push('');
    return lines.join('\n') + '\n';
  }

  for (var ledgerIndex = 0; ledgerIndex < ledgerOrder.length; ledgerIndex++) {
    var ledgerType = ledgerOrder[ledgerIndex];
    var groupRows = [];

    for (var rowIndex = 0; rowIndex < rows.length; rowIndex++) {
      if (rows[rowIndex].ledger_type === ledgerType) groupRows.push(rows[rowIndex]);
    }
    if (groupRows.length === 0) continue;

    lines.push(ledgerLabels[ledgerType]);
    lines.push('');
    for (var groupIndex = 0; groupIndex < groupRows.length; groupIndex++) {
      var row = groupRows[groupIndex];
      var side = getAccountingSide(row.account_type) === 'debit' ? 'Nợ' : 'Có';
      lines.push(
        '[' + safeString(row.id) + '] ' +
        side + ' TK ' + row.account_number + ' - ' + row.account_name +
        '    ' + formatReportMoney(row.amount) +
        '    [' + row.entry_type + ']'
      );
    }
    lines.push('');
  }

  lines.push(
    'Số dòng sinh ra: ' + testResult.summary.totalRows +
    ' - ' + (testResult.success ? 'ĐẠT' : 'KHÔNG ĐẠT')
  );
  lines.push('');
  return lines.join('\n') + '\n';
}

function formatReportMoney(value) {
  if (value === null || value === undefined || value === '') {
    return '(để trống - KT nhập)';
  }
  var text = String(Math.round(toNumber(value)));
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, '.') + ' VND';
}

function comparePaymentTestExpectation(actual, expectedInput) {
  var expected = parseJsonObject(expectedInput) || expectedInput;
  var failures = [];

  if (!expected || typeof expected !== 'object') {
    return { passed: true, skipped: true, failures: [] };
  }

  if (expected.totalRows !== undefined && toNumber(expected.totalRows) !== actual.totalRows) {
    failures.push('totalRows: expected ' + expected.totalRows + ', actual ' + actual.totalRows + '.');
  }

  if (expected.blankAmountRows !== undefined &&
      toNumber(expected.blankAmountRows) !== actual.blankAmountRows) {
    failures.push(
      'blankAmountRows: expected ' + expected.blankAmountRows +
      ', actual ' + actual.blankAmountRows + '.'
    );
  }

  if (expected.caseCodes && !sameTextArray(expected.caseCodes, actual.caseCodes)) {
    failures.push(
      'caseCodes: expected [' + expected.caseCodes.join(', ') +
      '], actual [' + actual.caseCodes.join(', ') + '].'
    );
  }

  var expectedCounts = expected.countsByEntryCode || {};
  for (var entryCode in expectedCounts) {
    if (!expectedCounts.hasOwnProperty(entryCode)) continue;
    var actualCount = actual.countsByEntryCode[entryCode] || 0;
    if (toNumber(expectedCounts[entryCode]) !== actualCount) {
      failures.push(
        entryCode + ': expected ' + expectedCounts[entryCode] + ', actual ' + actualCount + '.'
      );
    }
  }

  return {
    passed: failures.length === 0,
    skipped: false,
    failures: failures
  };
}

function sameTextArray(left, right) {
  if (!Array.isArray(left) || left.length !== right.length) return false;
  for (var i = 0; i < left.length; i++) {
    if (safeString(left[i]) !== safeString(right[i])) return false;
  }
  return true;
}

function getObjectTableRows(tableName) {
  if (!PAYMENT_OBJECT_DATABASE) return null;
  var rows = PAYMENT_OBJECT_DATABASE[tableName];
  return Array.isArray(rows) ? rows : [];
}

function selectObjectRows(tableName, criteria) {
  var rows = getObjectTableRows(tableName);
  var result = [];
  if (rows === null) return null;

  for (var i = 0; i < rows.length; i++) {
    var matched = true;
    for (var fieldName in criteria) {
      if (!criteria.hasOwnProperty(fieldName)) continue;
      if (safeString(readField(rows[i], fieldName)) !== safeString(criteria[fieldName])) {
        matched = false;
        break;
      }
    }
    if (matched) result.push(rows[i]);
  }

  return result;
}

// =============================================================================
// SECTION 03 - SAVE CHỈNH SỬA: validate dữ liệu UI và ghi lại toàn bộ bút toán
// =============================================================================

function savePaymentEntryEdit(details) {
  // SAVE-1: đọc dữ liệu người dùng gửi từ UI.
  var paymentId = safeString(details.paymentId).trim();
  var entries = parseJsonArray(details.entries);

  if (!paymentId) return makeError('Missing paymentId.');
  if (!entries) return makeError('Missing entries array.');

  // SAVE-2: kiểm tra giai đoạn và đúng cán bộ KTTC được phân công.
  var request = getPaymentRequest(paymentId);
  var previousEntries = getSavedPaymentEntries(paymentId);
  if (!isAccountingEditablePhase(request.current_phase)) {
    return makeError('Giai đoạn hiện tại không cho phép chỉnh sửa bút toán.');
  }
  var currentUser = getCurrentOperatorName();
  var isKttcCreator =
    normalizeText(request.initial_role) === 'kttc' &&
    isSameUser(request.created_by, currentUser);
  var isAssignedKttc = isSameUser(request.user_checker_kttc, currentUser);
  if (!isKttcCreator && !isAssignedKttc) {
    return makeError('Chỉ cán bộ KTTC khởi tạo hoặc được phân công mới được chỉnh sửa hạch toán.');
  }

  // SAVE-3: chuẩn hóa từng dòng và kiểm tra tổng Nợ = tổng Có.
  var normalized = normalizeEditedEntries(paymentId, entries, previousEntries);
  if (!normalized.success) return normalized;

  if (normalized.entries.length === 0) {
    var deletedAll = deletePaymentEntries(paymentId);
    return makeResult([], 'saved', {
      paymentId: paymentId,
      deleted: deletedAll,
      inserted: 0
    });
  }

  var balanceValidation = validateAccountingBalanceRows(normalized.entries);
  if (!balanceValidation.success) return balanceValidation;

  // SAVE-4: xóa bộ cũ và insert toàn bộ bộ mới đã validate.
  var deleted = deletePaymentEntries(paymentId);
  var inserted = insertPaymentEntries(normalized.entries);

  // SAVE-5: nếu insert thiếu dòng, khôi phục bộ dữ liệu cũ.
  if (inserted !== normalized.entries.length) {
    deletePaymentEntries(paymentId);
    var restored = insertPaymentEntries(previousEntries);

    return {
      success: false,
      error: 'Insert failed. Previous entries were restored.',
      paymentId: paymentId,
      deleted: deleted,
      inserted: inserted,
      restored: restored,
      data: getSavedPaymentEntries(paymentId)
    };
  }

  return {
    success: true,
    mode: 'saved',
    paymentId: paymentId,
    deleted: deleted,
    inserted: inserted,
    data: getSavedPaymentEntries(paymentId)
  };
}

function validateAccountingBalanceRows(rows) {
  if (!rows || rows.length === 0) {
    return makeError('Thông tin hạch toán là bắt buộc.');
  }

  var totalDebit = 0;
  var totalCredit = 0;

  for (var i = 0; i < rows.length; i++) {
    var accountSide = getAccountingSide(rows[i].account_type);
    var amount = toNumber(rows[i].amount);

    if (!accountSide) {
      return makeError('Bút toán dòng ' + (i + 1) + ' chưa xác định Ghi nợ/Ghi có.');
    }

    if (accountSide === 'debit') totalDebit += amount;
    if (accountSide === 'credit') totalCredit += amount;
  }

  // Validate tổng ghi nợ bằng tổng ghi có khi lưu chỉnh sửa bút toán.
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    return makeError('Tổng ghi nợ phải bằng tổng ghi có.');
  }

  return {
    success: true,
    totalDebit: totalDebit,
    totalCredit: totalCredit
  };
}

function getAccountingSide(value) {
  var accountType = normalizeBusinessText(value).replace(/\s+/g, '');
  if (accountType === 'debit') return 'debit';
  if (accountType === 'asset') return 'credit';
  return '';
}

function mapAccountingTableItems(rows) {
  var groups = {};
  var keys = [];
  var list = rows || [];
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var isGl = isAdditionalEntryType(row.type);
    var parts = isGl ? getGlEntryIdParts(row.payment_id, row.id) : null;
    var key = (isGl ? 'GL|' + safeString(parts ? parts.groupOrder : 1) :
      'AP|' + safeString(row.vendor_id) + '|' + safeString(row.vendor_site_id));
    if (!groups[key]) {
      groups[key] = { items: [], totalDebt: 0, totalCr: 0 };
      keys.push(key);
    }
    var side = getAccountingSide(row.account_type);
    var amount = toNumber(row.amount);
    var debt = side === 'debit' ? amount : 0;
    var credit = side === 'credit' ? amount : 0;
    groups[key].items.push({
      id: safeString(row.id).trim(),
      stt: isGl && parts ? parts.rowOrder : toNumber(row.order),
      accountNumner: safeString(row.account_number).trim(),
      accountName: safeString(row.account_name).trim(),
      bankName: '',
      description: safeString(row.description).trim(),
      debtAmount: debt,
      crAmount: credit
    });
    groups[key].totalDebt += debt;
    groups[key].totalCr += credit;
  }
  var result = [];
  for (var j = 0; j < keys.length; j++) result.push(groups[keys[j]]);
  return result;
}

// -----------------------------------------------------------------------------
// SECTION 03A - DANH MỤC GL: hỗ trợ chọn tài khoản khi chỉnh sửa
// -----------------------------------------------------------------------------

function getListGlAccount() {
  var rows = [];
  var f = new SCFile(TABLE_GL_ACCOUNT, SCFILE_READONLY);
  var rc;

  try {
    rc = f.doSelect('true');
  } catch (e) {
    closeFile(f);
    return makeError('Cannot read GL account list: ' + e.toString());
  }

  while (rc === RC_SUCCESS) {
    var account = readText(f, 'account');

    if (account) {
      var accountType = readText(f, 'account.type');

      rows.push({
        account: account,
        name: readText(f, 'name'),
        account_type: accountType,
        is_debit_eligible: isDebitEligibleAccountType(accountType),
        apply_currency: readText(f, 'apply.currency')
      });
    }

    rc = f.getNext();
  }

  closeFile(f);
  rows.sort(compareGlAccount);

  return {
    success: true,
    mode: 'gl-account-list',
    data: rows
  };
}

function getGlAccountName(accountNumber) {
  var account = safeString(accountNumber).trim();
  if (!account) return '';

  var row = selectOne(
    TABLE_GL_ACCOUNT,
    'account="' + escapeQueryValue(account) + '"',
    function (record) {
      return { name: readText(record, 'name') };
    }
  );

  return row ? row.name : '';
}

function isDebitEligibleAccountType(value) {
  var accountType = normalizeBusinessText(value).replace(/\s+/g, '');
  return accountType === 'duno' || accountType === 'luongtinh';
}

function compareGlAccount(a, b) {
  var left = safeString(a.account);
  var right = safeString(b.account);

  if (left === right) return 0;
  return left > right ? 1 : -1;
}

// -----------------------------------------------------------------------------
// SECTION 03B - VALIDATE SAVE: normalize từng dòng và kiểm tra dữ liệu bắt buộc
// -----------------------------------------------------------------------------

function normalizeEditedEntries(paymentId, entries, savedEntries) {
  var result = [];
  var usedIds = {};
  var savedIds = makeEntryIdSet(savedEntries);
  var nextManualApSequence = getNextManualEntryIdSequence(paymentId, savedEntries);
  var nextGlRowSequence = getNextGlRowSequence(paymentId, 1, savedEntries);

  for (var i = 0; i < entries.length; i++) {
    var row = normalizeEditedEntry(entries[i]);

    if (!savedIds[row.id]) {
      if (isAdditionalEntryType(row.type)) {
        if (!isStructuredGlEntryId(paymentId, row.id)) {
          row.id = makeGlEntryId(paymentId, 1, nextGlRowSequence++);
        }
      } else {
        row.id = makeUserAddedEntryId(paymentId, nextManualApSequence++);
      }
    }

    var validationError = validateEditedEntry(paymentId, row, i + 1, usedIds);

    if (validationError) return makeError(validationError);

    usedIds[row.id] = true;
    result.push(row);
  }

  return {
    success: true,
    entries: result
  };
}

function normalizeEditedEntry(raw) {
  var type = safeString(raw.type).trim();
  var isGlEntry = isAdditionalEntryType(type);
  var selectedGlEntityCode = safeString(raw.branch_entity_code).trim();

  return {
    id: safeString(raw.id).trim(),
    payment_id: safeString(raw.payment_id).trim(),
    entry_type: normalizeEntryType(raw.entry_type),
    ledger_type: LEDGER_TYPE.STANDARD,
    account_type: toStoredAccountType(raw.account_type),
    account_number: safeString(raw.account_number).trim(),
    account_name: safeString(raw.account_name).trim(),
    branch: isGlEntry && selectedGlEntityCode
      ? getGlBranchCodeByEntityCode(selectedGlEntityCode)
      : safeString(raw.branch).trim(),
    department: safeString(raw.department).trim(),
    transaction_office: safeString(raw.transaction_office).trim(),
    amount: toNumber(raw.amount),
    currency: safeString(raw.currency).trim(),
    description: safeString(raw.description).trim(),
    vendor_id: safeString(raw.vendor_id).trim(),
    type: isGlEntry ? TYPE.GL : TYPE.AP,
    order: toNumber(raw.order),
    accounting_request_id: safeString(raw.accounting_request_id).trim()
  };
}

function validateEditedEntry(paymentId, row, index, usedIds) {
  var prefix = 'Invalid entry at index ' + index + ': ';

  if (!row.id) return prefix + 'missing id.';
  if (usedIds[row.id]) return prefix + 'duplicate id ' + row.id + '.';
  if (row.payment_id !== paymentId) return prefix + 'payment_id does not match paymentId.';
  if (!row.entry_type) return prefix + 'missing entry_type.';
  if (!row.account_number) return prefix + 'missing account_number.';
  if (!(row.amount > 0)) return prefix + 'amount must be greater than 0.';
  if (!row.currency) return prefix + 'missing currency.';
  if (!row.type) return prefix + 'missing type.';
  if (isAdditionalEntryType(row.type) && !isStructuredGlEntryId(paymentId, row.id)) {
    return prefix + 'invalid GL id structure.';
  }
  if (isAdditionalEntryType(row.type) && !/^[0-9]{3}$/.test(row.branch)) {
    return prefix + 'missing or invalid GL branch.';
  }
  if (!(row.order > 0)) return prefix + 'order must be greater than 0.';

  return '';
}

function isAdditionalEntryType(value) {
  return normalizeText(value) === normalizeText(TYPE.GL);
}

// =============================================================================
// SUPPORT - QUY TẮC DÒNG: tên bút toán, ledger type và bên Nợ/Có
// =============================================================================

function getAutoLedgerType(entryCode) {
  return LEDGER_TYPE.STANDARD;
}

function getAutoAccountType(entryCode) {
  // Có (Credit): TT-BK-03, TT-BK-05, TT-BK-08
  if (entryCode === AUTO_ENTRY_CODE.LIABILITY) return ACCOUNT_TYPE.ASSET;
  if (entryCode === AUTO_ENTRY_CODE.REFUND_CR) return ACCOUNT_TYPE.ASSET;
  if (entryCode === AUTO_ENTRY_CODE.TRANSFER) return ACCOUNT_TYPE.ASSET;
  // Nợ (Debit): TT-BK-01, TT-BK-02, TT-BK-04, TT-BK-06, TT-BK-07
  return ACCOUNT_TYPE.DEBIT;
}

function toStoredAccountType(value) {
  var accountType = normalizeBusinessText(value).replace(/\s+/g, '');

  if (accountType === 'debit') return ACCOUNT_TYPE.DEBIT;
  if (accountType === 'asset') return ACCOUNT_TYPE.ASSET;

  return safeString(value).trim();
}

function normalizeEntryType(value) {
  var type = safeString(value).trim().toUpperCase();
  if (type === ENTRY_TYPE.COST) return ENTRY_TYPE.COST;
  if (type === ENTRY_TYPE.PREPAYMENT) return ENTRY_TYPE.PREPAYMENT;
  if (type === ENTRY_TYPE.TAX) return ENTRY_TYPE.TAX;
  if (type === ENTRY_TYPE.PAYABLE) return ENTRY_TYPE.PAYABLE;
  if (type === ENTRY_TYPE.CUSTOMER) return ENTRY_TYPE.CUSTOMER;
  return '';
}

function getEntryTypeByRuleCode(entryCode) {
  if (entryCode === AUTO_ENTRY_CODE.COST) return ENTRY_TYPE.COST;
  if (entryCode === AUTO_ENTRY_CODE.TAX) return ENTRY_TYPE.TAX;
  if (entryCode === AUTO_ENTRY_CODE.REFUND_CR) return ENTRY_TYPE.PREPAYMENT;
  if (entryCode === AUTO_ENTRY_CODE.TRANSFER) return ENTRY_TYPE.CUSTOMER;
  if (entryCode === AUTO_ENTRY_CODE.LIABILITY ||
      entryCode === AUTO_ENTRY_CODE.REFUND_DR ||
      entryCode === AUTO_ENTRY_CODE.PAYMENT ||
      entryCode === AUTO_ENTRY_CODE.SUSPENDED) return ENTRY_TYPE.PAYABLE;
  return '';
}

// =============================================================================
// SECTION 04/05 - ĐIỀU PHỐI: đọc dữ liệu, phân case và sinh bút toán từng NCC
// =============================================================================

/**
 * Tạo bộ TT-BK-01 → TT-BK-08 theo từng NCC.
 *
 * Luồng chính theo đặc tả 2.7:
 * 1) Xác định 5 biến: hasNewInvoice, hasRefund, hasSuspended, hasTax, remainingAmount
 * 2) Validate: phiếu phải có ≥ 1 nguồn (hóa đơn / hoàn ứng / khoản treo)
 * 3) Nhóm hóa đơn:    TT-BK-01 (chi phí), TT-BK-02 (thuế), TT-BK-03 (nghĩa vụ)
 * 4) Hoàn ứng: refund.amount chỉ dùng phân case; dòng Có TK tạm ứng được xử lý
 *    sau tại tab Công nợ theo "Số tiền hoàn ứng lần này".
 * 5) Thanh toán:       TT-BK-06 khi remainingAmount > 0
 * 6) Khoản treo:       TT-BK-07; riêng TT-17 bằng số tiền thanh toán
 * 7) Chuyển tiền:      TT-BK-08 = TT-BK-06 + TT-BK-07
 */
/**
 * Sinh bút toán theo 17 case thanh toán.
 * Các case chưa đủ quy tắc được giữ bằng hàm rỗng để bổ sung sau.
 */
function buildExpectedPaymentEntries(paymentId, vendorId) {
  debugPaymentEntry('BUILD', 'Bắt đầu paymentId=' + paymentId + ', vendorId=' + safeString(vendorId));
  var request = getPaymentRequest(paymentId);
  var vendors = getPaymentVendors(paymentId, vendorId);
  debugPaymentEntry('BUILD', 'Tìm thấy ' + vendors.length + ' NCC');
  var rows = [];
  var errors = [];
  var cases = [];
  var successfulVendorIds = [];
  var canGenerate = true;

  if (!request.id) {
    return {
      rows: [],
      canGenerate: false,
      errors: ['Không có dữ liệu ở bảng ' + TABLE_PAYMENT + '.'],
      cases: [],
      currentPhase: ''
    };
  }

  for (var vi = 0; vi < vendors.length; vi++) {
    vendors[vi] = enrichVendor(vendors[vi]);
  }

  var invoiceVendorErrors = getLinkedInvoiceVendorErrors(paymentId, vendors);
  if (invoiceVendorErrors.length > 0) {
    canGenerate = false;
    errors = errors.concat(invoiceVendorErrors);
  }

  for (var i = 0; i < vendors.length; i++) {
    var vendor = vendors[i];
    debugPaymentEntry('BUILD-VENDOR', 'Bắt đầu NCC ' + (vendor.vendor_id || '?') + ' (' + (i + 1) + '/' + vendors.length + ')');
    var vendorErrors = getVendorAutoEntryErrors(vendor);
    if (vendorErrors.length > 0) {
      debugPaymentEntry('BUILD-VENDOR-ERROR', 'NCC ' + (vendor.vendor_id || '?') + ': ' + vendorErrors.join(' | '));
      canGenerate = false;
      errors = errors.concat(vendorErrors);
      continue;
    }

    // Bước 1: gom toàn bộ dữ liệu cần phân case của một NCC.
    var context = buildPaymentCaseContext(
      paymentId,
      request,
      vendor,
      vendors.length,
      rows.length + 1
    );

    if (context.errors.length > 0) {
      debugPaymentEntry('BUILD-VENDOR-ERROR', 'NCC ' + (vendor.vendor_id || '?') + ': ' + context.errors.join(' | '));
      canGenerate = false;
      errors = errors.concat(context.errors);
      continue;
    }

    // Bước 2: chỉ phân case tại đây; không rải điều kiện case sang phần save.
    var caseCode = classifyPaymentCase(context);
    debugPaymentEntry('BUILD-CASE', 'NCC ' + (vendor.vendor_id || '?') + ' => ' + (caseCode || 'NO_CASE'));
    cases.push({ vendorId: vendor.vendor_id, caseCode: caseCode });

    if (!caseCode) {
      canGenerate = false;
      errors.push('NCC ' + (vendor.vendor_id || '?') + ': dữ liệu số tiền không khớp case TT-01 đến TT-17.');
      continue;
    }

    if (!isImplementedPaymentCase(caseCode)) {
      canGenerate = false;
      errors.push('NCC ' + (vendor.vendor_id || '?') + ': case ' + caseCode + ' đang để hàm rỗng, chưa sinh bút toán.');
      continue;
    }

    if (isHumanActionPaymentCase(caseCode) && !context.hasUserAccountingAction) {
      canGenerate = false;
      errors.push('NCC ' + (vendor.vendor_id || '?') + ': ' + caseCode +
        ' chi hop le sau khi co tac dong cua ke toan.');
      continue;
    }

    // Bước 3: gọi đúng handler TT-xx để tạo các dòng Nợ/Có.
    var vendorRows = buildEntriesByPaymentCase(caseCode, context);
    var rowErrors = getAutoEntryRowsErrors(vendorRows);
    if (rowErrors.length > 0) {
      debugPaymentEntry('BUILD-VENDOR-ERROR', 'NCC ' + (vendor.vendor_id || '?') + ': ' + rowErrors.join(' | '));
      canGenerate = false;
      errors = errors.concat(rowErrors);
      continue;
    }

    rows = rows.concat(vendorRows);
    successfulVendorIds.push(vendor.vendor_id);
    debugPaymentEntry('BUILD-VENDOR', 'NCC ' + (vendor.vendor_id || '?') + ' sinh thành công ' + vendorRows.length + ' dòng');
  }

  debugPaymentEntry('BUILD', 'Kết thúc: rows=' + rows.length + ', NCC thành công=' + successfulVendorIds.length + ', errors=' + errors.length);

  return {
    rows: rows,
    canGenerate: canGenerate,
    errors: makeUniqueTextList(errors),
    cases: cases,
    successfulVendorIds: successfulVendorIds,
    currentPhase: request.current_phase
  };
}

// -----------------------------------------------------------------------------
// SECTION 04A - DATA CASE: gom (1), (2), (3), thuế, loại NCC và Cost Division
// -----------------------------------------------------------------------------
function hasUserAccountingActionEntry(paymentId, vendorId) {
  var rows = selectObjectRows(TABLE_PAYMENT_ENTRY, {
    'payment.id': paymentId,
    'vendor.id': vendorId
  }) || [];

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var type = normalizeText(readField(row, 'type'));
    var entryType = normalizeEntryType(readField(row, 'entry.type'));
    if (type === normalizeText(TYPE.GL)) return true;
    if (type === normalizeText(TYPE.AP) && entryType === ENTRY_TYPE.PREPAYMENT) return true;
    if (type === normalizeText(TYPE.AP) && entryType === ENTRY_TYPE.PAYABLE &&
        toStoredAccountType(readField(row, 'account.type')) === ACCOUNT_TYPE.ASSET &&
        isUserAddedEntryId(readField(row, 'id'))) return true;
  }

  return false;
}

function buildPaymentCaseContext(paymentId, request, vendor, vendorCount, firstOrder) {
  var taxInfo = getInvoiceTaxInfo(paymentId, vendor, vendorCount);
  var hasInvoice = hasLinkedInvoicesForVendor(paymentId, vendor, vendorCount);
	var hasUserAccountingAction = hasUserAccountingActionEntry(paymentId, vendor.vendor_id);
  var approvedAmount = toNumber(vendor.approved_invoice_amount);
  // Phân bổ chi phí phục vụ hạch toán giá trị được chấp nhận (1), không phụ
  // thuộc việc phiếu đã gắn bản ghi hóa đơn hay chưa.
  var costDivisions = approvedAmount > 0
    ? getPaymentCostDivisions(paymentId, vendor.vendor_id)
    : [];
  var isPersonal = isPersonalPaymentVendor(vendor.vendor_type);
  // Cá nhân không dùng thuế GTGT tự động; thuế TNCN và số tiền do KT nhập.
  var errors = isPersonal ? [] : taxInfo.errors.slice(0);

  if (approvedAmount > 0 && costDivisions.length === 0 && isPersonal && !vendor.debit_account) {
    errors.push('NCC cá nhân ' + (vendor.vendor_id || '?') + ': không có PCCP và thiếu debit.account tại ' + TABLE_VENDOR_SITE + '.');
  }
  for (var costIndex = 0; costIndex < costDivisions.length; costIndex++) {
    if (!moneyIsPositive(costDivisions[costIndex].amount)) {
      errors.push(
        'NCC ' + (vendor.vendor_id || '?') + ': dòng PCCP ' +
        (costDivisions[costIndex].id || costIndex + 1) +
        ' thiếu hoặc có amount không hợp lệ tại ' + TABLE_COST_DIVISION + '.'
      );
    }
  }

  return {
    paymentId: paymentId,
    request: request,
    vendor: vendor,
    vendorCount: vendorCount,
    approvedAmount: approvedAmount,                            // (1)
    paymentAmount: toNumber(vendor.amount),                    // (2)
    refundAmount: toNumber(vendor.refund_amount),              // (3)
    hasInvoice: hasInvoice,
    hasTax: hasInvoice && taxInfo.hasDeductibleTax,
    isPersonal: isPersonal,
    taxInfo: taxInfo,
    costDivisions: costDivisions,
		hasUserAccountingAction: hasUserAccountingAction,
    firstOrder: firstOrder,
    errors: errors
  };
}

// -----------------------------------------------------------------------------
// SECTION 04B - PHÂN CASE: toàn bộ điều kiện TT-01 đến TT-17 nằm tại đây
// -----------------------------------------------------------------------------
/**
 * BANG QUYET DINH la nguon quy tac uu tien cao nhat.
 * Case trung dieu kien phan biet bang AP/PREPAYMENT, AP/PAYABLE thu cong hoac GL.
 * (1) Giá trị hóa đơn chấp nhận; (2) Số tiền đề nghị; (3) Số tiền hoàn ứng.
 */
function classifyPaymentCase(c) {
  var invoice = c.approvedAmount;
  var payment = c.paymentAmount;
  var refund = c.refundAmount;
  var personal = c.isPersonal;
  var tax = c.hasTax;

  // Không có hóa đơn, chỉ đề nghị thanh toán.
  if (moneyIsZero(invoice) && moneyIsPositive(payment)) return PAYMENT_CASE.TT17;

  // Không hoàn ứng: (1) = (2).
  if (moneyIsZero(refund) && moneyEquals(invoice, payment)) {
    if (personal) return PAYMENT_CASE.TT02;
    if (!tax) return PAYMENT_CASE.TT01;
    return PAYMENT_CASE.TT03;
  }

  // Không hoàn ứng: (1) > (2).
  if (moneyIsZero(refund) && moneyGreaterThan(invoice, payment)) {
    if (personal) return PAYMENT_CASE.TT05;
    if (!tax) return PAYMENT_CASE.TT04;
    return PAYMENT_CASE.TT06;
  }

  // Chỉ hoàn ứng: (1) = (3), không đi tiền.
  if (moneyIsPositive(refund) && moneyIsZero(payment) && moneyEquals(invoice, refund)) {
    return PAYMENT_CASE.TT07;
  }

  // Có hoàn ứng, không đi tiền: (1) khác (3).
  if (moneyIsPositive(refund) && moneyIsZero(payment) && !moneyEquals(invoice, refund)) {
    if (personal) return PAYMENT_CASE.TT13;
    if (!tax) return PAYMENT_CASE.TT11;
    return PAYMENT_CASE.TT12;
  }

  // Có cả hoàn ứng và đi tiền: phân biệt bằng hành động của kế toán.
  // Luon xac dinh case co ban TT-08..TT-10 truoc. TT-14..TT-16 chi la
  // trang thai dac biet sau khi co tac dong nguoi dung, khong phai case khoi tao.
  if (moneyIsPositive(refund) && moneyIsPositive(payment)) {
    var baseCase = personal
      ? PAYMENT_CASE.TT10
      : (!tax ? PAYMENT_CASE.TT08 : PAYMENT_CASE.TT09);
    return c.hasUserAccountingAction ? toHumanActionPaymentCase(baseCase) : baseCase;
  }

  return '';
}

// Các hàm so sánh tiền dùng chung cho phần chia case.
function moneyEquals(left, right) {
  return Math.abs(toNumber(left) - toNumber(right)) <= MONEY_EPSILON;
}

function moneyIsZero(value) {
  return Math.abs(toNumber(value)) <= MONEY_EPSILON;
}

function moneyIsPositive(value) {
  return toNumber(value) > MONEY_EPSILON;
}

function moneyGreaterThan(left, right) {
  return toNumber(left) - toNumber(right) > MONEY_EPSILON;
}

function isPersonalPaymentVendor(vendorType) {
  var value = normalizeBusinessText(vendorType).replace(/\s+/g, '');
  return value === 'cn' || value === 'canhan';
}

// Chỉ cho phép sinh DB đối với các case đã được hoàn thiện.
function isImplementedPaymentCase(caseCode) {
  return caseCode === PAYMENT_CASE.TT01 ||
    caseCode === PAYMENT_CASE.TT02 ||
    caseCode === PAYMENT_CASE.TT03 ||
    caseCode === PAYMENT_CASE.TT04 ||
    caseCode === PAYMENT_CASE.TT05 ||
    caseCode === PAYMENT_CASE.TT06 ||
    caseCode === PAYMENT_CASE.TT07 ||
    caseCode === PAYMENT_CASE.TT08 ||
    caseCode === PAYMENT_CASE.TT09 ||
    caseCode === PAYMENT_CASE.TT10 ||
    caseCode === PAYMENT_CASE.TT11 ||
    caseCode === PAYMENT_CASE.TT12 ||
    caseCode === PAYMENT_CASE.TT13 ||
    caseCode === PAYMENT_CASE.TT14 ||
    caseCode === PAYMENT_CASE.TT15 ||
    caseCode === PAYMENT_CASE.TT16 ||
    caseCode === PAYMENT_CASE.TT17;
}

// -----------------------------------------------------------------------------
// SECTION 05A - CASE ROUTER: ánh xạ mã case sang đúng hàm sinh bút toán
// -----------------------------------------------------------------------------
function buildEntriesByPaymentCase(caseCode, context) {
  if (caseCode === PAYMENT_CASE.TT01) return buildPaymentCaseTT01(context);
  if (caseCode === PAYMENT_CASE.TT02) return buildPaymentCaseTT02(context);
  if (caseCode === PAYMENT_CASE.TT03) return buildPaymentCaseTT03(context);
  if (caseCode === PAYMENT_CASE.TT04) return buildPaymentCaseTT04(context);
  if (caseCode === PAYMENT_CASE.TT05) return buildPaymentCaseTT05(context);
  if (caseCode === PAYMENT_CASE.TT06) return buildPaymentCaseTT06(context);
  if (caseCode === PAYMENT_CASE.TT07) return buildPaymentCaseTT07(context);
  if (caseCode === PAYMENT_CASE.TT08) return buildPaymentCaseTT08(context);
  if (caseCode === PAYMENT_CASE.TT09) return buildPaymentCaseTT09(context);
  if (caseCode === PAYMENT_CASE.TT10) return buildPaymentCaseTT10(context);
  if (caseCode === PAYMENT_CASE.TT11) return buildPaymentCaseTT11(context);
  if (caseCode === PAYMENT_CASE.TT12) return buildPaymentCaseTT12(context);
  if (caseCode === PAYMENT_CASE.TT13) return buildPaymentCaseTT13(context);
  if (caseCode === PAYMENT_CASE.TT14) return buildPaymentCaseTT14(context);
  if (caseCode === PAYMENT_CASE.TT15) return buildPaymentCaseTT15(context);
  if (caseCode === PAYMENT_CASE.TT16) return buildPaymentCaseTT16(context);
  if (caseCode === PAYMENT_CASE.TT17) return buildPaymentCaseTT17(context);
  return [];
}

// -----------------------------------------------------------------------------
// SECTION 05B - CASE ĐÃ CODE: 16 case khởi tạo invoice
// -----------------------------------------------------------------------------
// Mỗi hàm chỉ khai báo thành phần cần sinh; logic tạo dòng nằm ở SECTION 05D.
// Số dòng hiển thị (n = số Cost Division, t = số nhóm thuế):
// TT-01 n+1; TT-03 n+t+1; TT-04 n+2; TT-06 n+t+2; TT-07 n(+t)+1;
// TT-08 n+2; TT-09 n+t+2; TT-11 n+2; TT-12 n+t+2;
// TT-14 n+3; TT-15 n+t+3.
function buildPaymentCaseTT01(c) { return buildStandardPaymentCase(c, true, false, false, true); }
function buildPaymentCaseTT03(c) { return buildStandardPaymentCase(c, true, true,  false, true); }
function buildPaymentCaseTT04(c) { return buildStandardPaymentCase(c, true, false, false, true); }
function buildPaymentCaseTT06(c) { return buildStandardPaymentCase(c, true, true,  false, true); }
function buildPaymentCaseTT07(c) { return buildStandardPaymentCase(c, true, c.hasTax, true, false); }
function buildPaymentCaseTT08(c) { return buildStandardPaymentCase(c, true, false, true, true); }
function buildPaymentCaseTT09(c) { return buildStandardPaymentCase(c, true, true,  true, true); }
function buildPaymentCaseTT11(c) { return buildStandardPaymentCase(c, true, false, true, false, true); }
function buildPaymentCaseTT12(c) { return buildStandardPaymentCase(c, true, true,  true, false, true); }
function buildPaymentCaseTT14(c) { return buildStandardPaymentCase(c, true, false, true, true,  true); }
function buildPaymentCaseTT15(c) { return buildStandardPaymentCase(c, true, true,  true, true,  true); }

// Case cá nhân: sinh tài khoản, để trống số tiền KT phải nhập.
function buildPaymentCaseTT02(c) { return buildPersonalPaymentCase(c, false, true); }
function buildPaymentCaseTT05(c) { return buildPersonalPaymentCase(c, false, true); }
function buildPaymentCaseTT10(c) { return buildPersonalPaymentCase(c, true,  true); }
function buildPaymentCaseTT13(c) { return buildPersonalPaymentCase(c, true,  false, true); }
function buildPaymentCaseTT16(c) { return buildPersonalPaymentCase(c, true,  true,  true); }

// TT-17: khoản treo bằng số tiền thanh toán; sinh Nợ Phải trả và Có Khách hàng.
function buildPaymentCaseTT17(c) {
  return [
    buildEntryRow({
      paymentId: c.paymentId,
      request: c.request,
      vendor: c.vendor,
      entryCode: AUTO_ENTRY_CODE.SUSPENDED,
      amount: c.paymentAmount,
      order: c.firstOrder
    }),
    buildEntryRow({
      paymentId: c.paymentId,
      request: c.request,
      vendor: c.vendor,
      entryCode: AUTO_ENTRY_CODE.TRANSFER,
      amount: c.paymentAmount,
      order: c.firstOrder + 1
    })
  ];
}

function toHumanActionPaymentCase(baseCase) {
  if (baseCase === PAYMENT_CASE.TT08) return PAYMENT_CASE.TT14;
  if (baseCase === PAYMENT_CASE.TT09) return PAYMENT_CASE.TT15;
  if (baseCase === PAYMENT_CASE.TT10) return PAYMENT_CASE.TT16;
  return baseCase;
}

function isHumanActionPaymentCase(caseCode) {
  return caseCode === PAYMENT_CASE.TT14 ||
    caseCode === PAYMENT_CASE.TT15 ||
    caseCode === PAYMENT_CASE.TT16;
}

/**
 * Sinh paymentEntry cho NCC cá nhân.
 * - Có PCCP: mỗi account.number duy nhất sinh một dòng chi phí.
 * - Không PCCP: sinh một dòng chi phí từ vendorSite.debit.account.
 * - Có PCCP: tiền chi phí lấy từ tổng amount theo tài khoản.
 * - Không PCCP: tiền chi phí để trống cho KT nhập.
 * - Dòng đi tiền và phải trả vẫn để amount=null cho KT nhập.
 * - refund.amount chỉ dùng phân case; không sinh Có TK tạm ứng tại đây.
 */
function buildPersonalPaymentCase(c, includeRefund, includePayment, accountingCreatesCredit) {
  var rows = [];
  var order = c.firstOrder;
  var expenseAccounts = getPersonalExpenseAccounts(c);
  var i;

  for (i = 0; i < expenseAccounts.length; i++) {
    rows.push(buildEntryRow({
      paymentId: c.paymentId,
      request: c.request,
      vendor: c.vendor,
      entryCode: AUTO_ENTRY_CODE.COST,
      amount: expenseAccounts[i].from_cost_division
        ? expenseAccounts[i].amount
        : null,
      allowBlankAmount: !expenseAccounts[i].from_cost_division,
      order: order++,
      accountOverride: {
        number: expenseAccounts[i].account_number,
        name: expenseAccounts[i].account_name
      },
      departmentOverride: expenseAccounts[i].department,
      branchOverride: expenseAccounts[i].branch
    }));
  }

  // SỬA NGHIỆP VỤ HOÀN ỨNG:
  // refund.amount chỉ dùng để phân case có/không có tạm ứng.
  // Không sinh dòng Có TK tạm ứng (TT-BK-05) tại paymentEntry.
  // Dòng này sẽ được xử lý sau khi người dùng nhập "Số tiền hoàn ứng lần này"
  // tại tab Công nợ.

  // TT-13, TT-16: chi sinh dong ghi No; dong ghi Co do ke toan tu sinh.
  if (accountingCreatesCredit) return rows;

  if (includePayment && moneyIsPositive(c.paymentAmount)) {
    rows.push(buildEntryRow({
      paymentId: c.paymentId,
      request: c.request,
      vendor: c.vendor,
      entryCode: AUTO_ENTRY_CODE.TRANSFER,
      amount: null,
      allowBlankAmount: true,
      order: order++
    }));
  }

  // SỬA NGHIỆP VỤ HOÀN ỨNG:
  // refund.amount chỉ phân case, không giảm công nợ paymentEntry.
  if (moneyGreaterThan(c.approvedAmount, c.paymentAmount)) {
    rows.push(buildEntryRow({
      paymentId: c.paymentId,
      request: c.request,
      vendor: c.vendor,
      entryCode: AUTO_ENTRY_CODE.LIABILITY,
      amount: null,
      allowBlankAmount: true,
      order: order++
    }));
  }

  return rows;
}

function getPersonalExpenseAccounts(c) {
  var result = [];
  var allocationByAccount = {};

  for (var i = 0; i < c.costDivisions.length; i++) {
    var division = c.costDivisions[i];
    var accountNumber = safeString(division.account_number).trim();
    if (!accountNumber) continue;

    var allocation = allocationByAccount[accountNumber];
    if (!allocation) {
      allocation = {
        account_number: accountNumber,
        account_name: division.account_name || getGlAccountName(accountNumber),
        department: division.department,
        branch: division.branch,
        amount: 0,
        from_cost_division: true
      };
      allocationByAccount[accountNumber] = allocation;
      result.push(allocation);
    }
    allocation.amount += toNumber(division.amount);
  }

  if (result.length === 0) {
    result.push({
      account_number: c.vendor.debit_account,
      account_name: getGlAccountName(c.vendor.debit_account),
      department: c.request.department,
      branch: '',
      amount: null,
      from_cost_division: false
    });
  }

  return result;
}

/**
 * Gom PCCP theo tài khoản để mỗi tài khoản chỉ sinh một dòng chi phí.
 * Khi không có PCCP, dùng đúng một dòng từ vendorSite.debit.account.
 */
function getStandardExpenseAllocations(c) {
  var result = [];
  var allocationByAccount = {};

  for (var i = 0; i < c.costDivisions.length; i++) {
    var division = c.costDivisions[i];
    var accountNumber = safeString(division.account_number).trim();
    if (!accountNumber) continue;

    var allocation = allocationByAccount[accountNumber];
    if (!allocation) {
      allocation = {
        account_number: accountNumber,
        account_name: division.account_name || getGlAccountName(accountNumber),
        department: division.department,
        branch: division.branch,
        amount: 0
      };
      allocationByAccount[accountNumber] = allocation;
      result.push(allocation);
    }
    allocation.amount += toNumber(division.amount);
  }

  if (result.length === 0) {
    result.push({
      account_number: c.vendor.debit_account,
      account_name: getGlAccountName(c.vendor.debit_account),
      department: c.request.department,
      branch: '',
      amount: Math.max(0, c.approvedAmount - (c.hasTax ? c.taxInfo.totalDeductibleTax : 0))
    });
  }

  return result;
}

// -----------------------------------------------------------------------------
// SECTION 05D - ENTRY BUILDER DÙNG CHUNG: tạo dòng Nợ/Có, tránh lặp giữa case
// -----------------------------------------------------------------------------
/**
 * Sinh đúng các dòng được hiển thị tại tab Hạch toán.
 *
 * Không lưu các cặp TK phải trả trung gian của Standard / Payment.
 * refund.amount chỉ dùng phân case, chưa tham gia hạch toán paymentEntry.
 * Chỉ lưu một dòng TK phải trả bằng số chênh lệch:
 *   Có phải trả - Nợ phải trả = (1) - (2).
 *
 * Thứ tự hiển thị:
 *   chi phí -> thuế -> Có tài khoản đi tiền -> phải trả còn lại.
 */
function buildStandardPaymentCase(c, includeInvoice, includeTax, includeRefund, includePayment, accountingCreatesCredit) {
  var rows = [];
  var order = c.firstOrder;
  var i;
  var payableCredit = includeInvoice ? c.approvedAmount : 0;
  var payableDebit = 0;

  if (includeInvoice) {
    var expenseAllocations = getStandardExpenseAllocations(c);
    for (i = 0; i < expenseAllocations.length; i++) {
      var division = expenseAllocations[i];
      rows.push(buildEntryRow({
        paymentId: c.paymentId,
        request: c.request,
        vendor: c.vendor,
        entryCode: AUTO_ENTRY_CODE.COST,
        amount: toNumber(division.amount),
        order: order++,
        accountOverride: { number: division.account_number, name: division.account_name },
        departmentOverride: division.department,
        branchOverride: division.branch
      }));
    }

    if (includeTax) {
      for (i = 0; i < c.taxInfo.groups.length; i++) {
        rows.push(buildEntryRow({
          paymentId: c.paymentId,
          request: c.request,
          vendor: c.vendor,
          entryCode: AUTO_ENTRY_CODE.TAX,
          amount: c.taxInfo.groups[i].amount,
          order: order++,
          taxInfo: c.taxInfo.groups[i]
        }));
      }
    }

  }

  // SỬA NGHIỆP VỤ HOÀN ỨNG:
  // Chỉ dùng refund.amount để phân case. Chưa cộng khoản này vào payableDebit
  // và chưa sinh TT-BK-05, vì số tiền hạch toán phải lấy từ trường
  // "Số tiền hoàn ứng lần này" tại tab Công nợ.

  // TT-11, TT-12, TT-14, TT-15: chi sinh dong ghi No;
  // cac dong ghi Co do ke toan tu sinh.
  if (accountingCreatesCredit) return rows;

  if (includePayment && moneyIsPositive(c.paymentAmount)) {
    // Dòng Nợ phải trả của Payment được khử; chỉ hiển thị Có tài khoản đi tiền.
    payableDebit += c.paymentAmount;
    rows.push(buildEntryRow({
      paymentId: c.paymentId,
      request: c.request,
      vendor: c.vendor,
      entryCode: AUTO_ENTRY_CODE.TRANSFER,
      amount: c.paymentAmount,
      order: order++
    }));
  }

  // Chỉ hiển thị TK phải trả khi sau khử vẫn còn số dư Có.
  var payableDifference = payableCredit - payableDebit;
  if (moneyIsPositive(payableDifference)) {
    rows.push(buildEntryRow({
      paymentId: c.paymentId,
      request: c.request,
      vendor: c.vendor,
      entryCode: AUTO_ENTRY_CODE.LIABILITY,
      amount: payableDifference,
      order: order++
    }));
  }

  return rows;
}

// =============================================================================
// SECTION 08 - INTEGRATION: chỉ dựng khung payload, chưa gọi hệ thống ngoài
// =============================================================================

function buildPaymentIntegrationDraft(caseCode, context, entries) {
  return {
    caseCode: caseCode,
    createInvoice: buildCreateInvoicePayload(context, entries),
    applyPrepayment: buildApplyPrepaymentPayload(context, entries),
    createPayment: buildCreatePaymentPayload(context, entries),
    generalLedger: buildGeneralLedgerPayload(context, entries),
    coreTransfer: buildCoreTransferPayload(context, entries)
  };
}

function buildCreateInvoicePayload(context, entries) {
  // TODO-INTEGRATION: fill payload tạo Invoice/AP.
  return {};
}

function buildApplyPrepaymentPayload(context, entries) {
  // TODO-INTEGRATION: fill payload Apply Prepayment cho hoàn ứng.
  return {};
}

function buildCreatePaymentPayload(context, entries) {
  // TODO-INTEGRATION: fill payload tạo Payment.
  return {};
}

function buildGeneralLedgerPayload(context, entries) {
  // TODO-INTEGRATION: fill payload đồng bộ GL.
  return {};
}

function buildCoreTransferPayload(context, entries) {
  // TODO-INTEGRATION: fill payload đi tiền Core Banking.
  return {};
}

// =============================================================================
// SUPPORT - LEGACY REFERENCE: code cũ chỉ để đối chiếu, KHÔNG được gọi
// =============================================================================
// Luồng chạy thực tế chỉ dùng buildExpectedPaymentEntries tại SECTION 04/05.
function buildExpectedPaymentEntriesLegacy(paymentId, vendorId) {
  var request = getPaymentRequest(paymentId);
  var vendors = getPaymentVendors(paymentId, vendorId);
  var rows = [];
  var errors = [];
  var canGenerate = true;

  if (!request.id) {
    canGenerate = false;
    errors.push('Không có dữ liệu ở bảng ' + TABLE_PAYMENT + '.');
  }

  for (var vendorIndex = 0; vendorIndex < vendors.length; vendorIndex++) {
    vendors[vendorIndex] = enrichVendor(vendors[vendorIndex]);
  }

  if (vendors.length > 0) {
    var invoiceVendorErrors = getLinkedInvoiceVendorErrors(paymentId, vendors);
    if (invoiceVendorErrors.length > 0) {
      canGenerate = false;
      errors = errors.concat(invoiceVendorErrors);
    }
  }

  for (var i = 0; i < vendors.length; i++) {
    var vendor = vendors[i];
    var vendorErrors = getVendorAutoEntryErrors(vendor);

    // Kiểm tra NCC có đủ điều kiện sinh tự động hay không
    if (vendorErrors.length > 0) {
      canGenerate = false;
      errors = errors.concat(vendorErrors);
      continue;
    }

    // ===== Bước 1: Xác định 5 biến điều kiện =====

    var hasNewInvoice = hasLinkedInvoicesForVendor(paymentId, vendor, vendors.length);

    // CODE CŨ ĐỂ ĐỐI CHIẾU: trước đây chưa đọc refund.amount theo NCC.
    var hasRefund = false;

    // CODE LEGACY KHÔNG ĐƯỢC GỌI: TT-17 được xử lý tại buildPaymentCaseTT17().
    var hasSuspended = false;

    var taxInfo = getInvoiceTaxInfo(paymentId, vendor, vendors.length);
    if (taxInfo.errors.length > 0) {
      canGenerate = false;
      errors = errors.concat(taxInfo.errors);
    }
    var hasTax = hasNewInvoice && taxInfo.hasDeductibleTax;

    // CODE CŨ ĐỂ ĐỐI CHIẾU: số tiền đề nghị lấy từ vendor.amount.
    var paymentRequestAmount = toNumber(vendor.amount);

    // CODE CŨ ĐỂ ĐỐI CHIẾU: cách lấy hoàn ứng cấp phiếu đã được thay bằng vendor.refund_amount.
    // Khi có bảng hoàn ứng, nên tính tổng theo NCC thay vì dùng giá trị cấp phiếu.
    var refundAmount = toNumber(request.total_refund_amount);

    var remainingAmount = paymentRequestAmount - refundAmount;

    // ===== Bước 2: Validate nguồn =====
    if (!hasNewInvoice && !hasRefund && !hasSuspended) {
      canGenerate = false;
      errors.push('NCC ' + (vendor.vendor_id || '?') + ': phiếu phải gắn ít nhất một nguồn (hóa đơn mới / hoàn ứng / khoản treo).');
      continue;
    }

    // ===== Bước 3: Xây dựng các dòng bút toán =====

    var vendorRows = [];
    var orderCounter = rows.length + 1;

    // ---------- Nhóm hóa đơn mới (TT-BK-01, 02, 03) ----------
    if (hasNewInvoice) {
      // ĐÃ CHỐT: Cost Division lọc theo payment.id và vendor.id.
      var costDivisions = getPaymentCostDivisions(paymentId, vendor.vendor_id);

      if (costDivisions.length === 0) {
        canGenerate = false;
        errors.push('NCC ' + (vendor.vendor_id || '?') + ': có hóa đơn nhưng chưa có phân bổ chi phí tại ' + TABLE_COST_DIVISION + '.');
        continue;
      }

      // TT-BK-01: Ghi nhận chi phí — lặp theo từng dòng phân bổ
      var totalCostAmount = 0;
      for (var cdIndex = 0; cdIndex < costDivisions.length; cdIndex++) {
        var cd = costDivisions[cdIndex];
        var costAmount = toNumber(cd.amount);
        totalCostAmount += costAmount;

        vendorRows.push(buildEntryRow({
          paymentId: paymentId,
          request: request,
          vendor: vendor,
          entryCode: AUTO_ENTRY_CODE.COST,
          amount: costAmount,
          order: orderCounter++,
          accountOverride: {
            number: cd.account_number,
            name: cd.account_name
          },
          departmentOverride: cd.department,
          branchOverride: cd.branch
        }));
      }

      // TT-BK-02: Thuế GTGT — lặp theo nhóm loại khấu trừ
      if (hasTax) {
        for (var taxIndex = 0; taxIndex < taxInfo.groups.length; taxIndex++) {
          var taxGroup = taxInfo.groups[taxIndex];

          vendorRows.push(buildEntryRow({
            paymentId: paymentId,
            request: request,
            vendor: vendor,
            entryCode: AUTO_ENTRY_CODE.TAX,
            amount: taxGroup.amount,
            order: orderCounter++,
            taxInfo: taxGroup
          }));
        }
      }

      // TT-BK-03: Ghi nhận nghĩa vụ thanh toán
      // CODE CŨ ĐỂ ĐỐI CHIẾU: luồng mới dùng approved.invoice.amount.
      var invoiceValue = totalCostAmount + (taxInfo.hasDeductibleTax ? taxInfo.totalDeductibleTax : 0);

      vendorRows.push(buildEntryRow({
        paymentId: paymentId,
        request: request,
        vendor: vendor,
        entryCode: AUTO_ENTRY_CODE.LIABILITY,
        amount: invoiceValue,
        order: orderCounter++
      }));
    }

    // Hoàn ứng không sinh tại paymentEntry; xử lý sau tại tab Công nợ.

    // ---------- TT-BK-06: Thanh toán ----------
    var actualPaymentAmount = 0;
    if (remainingAmount > 0) {
      actualPaymentAmount = remainingAmount;

      vendorRows.push(buildEntryRow({
        paymentId: paymentId,
        request: request,
        vendor: vendor,
        entryCode: AUTO_ENTRY_CODE.PAYMENT,
        amount: actualPaymentAmount,
        order: orderCounter++
      }));
    }

    // ---------- Nhóm khoản treo (TT-BK-07) — sinh độc lập ----------
    /*
     * CODE LEGACY KHÔNG ĐƯỢC GỌI: luồng TT-17 hiện dùng payment.amount làm
     * số tiền TT-BK-07 tại buildPaymentCaseTT17().
     * Khi có thông tin, cài đặt:
     *   var suspendedInfo = getSuspendedPaymentInfo(paymentId, vendor.vendor_id);
     *   if (suspendedInfo && suspendedInfo.amount > 0) {
     *     hasSuspended = true;
     *     suspendedAmount = suspendedInfo.amount;
     *     vendorRows.push(buildEntryRow({
     *       paymentId: paymentId, request: request, vendor: vendor,
     *       entryCode: AUTO_ENTRY_CODE.SUSPENDED,
     *       amount: suspendedAmount,
     *       order: orderCounter++
     *     }));
     *   }
     */
    var suspendedAmount = 0;

    // ---------- TT-BK-08: Chuyển tiền ----------
    // Cộng dồn từ TT-BK-06 (nếu có) + TT-BK-07 (nếu có). Chỉ sinh 1 dòng / NCC.
    var transferAmount = actualPaymentAmount + suspendedAmount;
    if (transferAmount > 0) {
      vendorRows.push(buildEntryRow({
        paymentId: paymentId,
        request: request,
        vendor: vendor,
        entryCode: AUTO_ENTRY_CODE.TRANSFER,
        amount: transferAmount,
        order: orderCounter++
      }));
    }

    // Kiểm tra tính hợp lệ của các dòng bút toán vừa sinh
    var rowErrors = getAutoEntryRowsErrors(vendorRows);
    if (rowErrors.length > 0) {
      canGenerate = false;
      errors = errors.concat(rowErrors);
      continue;
    }

    rows = rows.concat(vendorRows);
  }

  return {
    rows: rows,
    canGenerate: canGenerate,
    errors: makeUniqueTextList(errors),
    currentPhase: request.current_phase
  };
}

// =============================================================================
// SECTION 05E - BUILD ENTRY ROW: chuẩn hóa cấu trúc một dòng paymentEntry
// =============================================================================

function buildEntryRow(params) {
  var account = params.accountOverride || resolveAccount(params.entryCode, params.vendor, params.taxInfo || {});
  var entryType = getEntryTypeByRuleCode(params.entryCode);
  var beneficiary = getBeneficiaryByEntryType(entryType, params.vendor);

  return {
    id: '',
    payment_id: params.paymentId,
    entry_type: entryType,
    rule_code: params.entryCode,
    ledger_type: getAutoLedgerType(params.entryCode),
    account_type: getAutoAccountType(params.entryCode),
    account_number: account.number,
    account_name: account.name,
    branch: params.branchOverride || '',
    department: params.departmentOverride || params.request.department,
    transaction_office: params.transactionOfficeOverride || '',
    amount: params.amount,
    currency: params.vendor.currency,
    description: params.request.description || '',
    vendor_id: params.vendor.vendor_id,
    type: TYPE.AP,
    order: params.order,
    accounting_request_id: '',
    payment_method: params.vendor.payment_method,
    beneficiary_account: beneficiary.account,
    beneficiary_name: beneficiary.name,
    beneficiary_bank: beneficiary.bank,
    // Chỉ dùng trong bước validate lúc khởi tạo case cá nhân; không lưu DB.
    allow_blank_amount: params.allowBlankAmount === true
  };
}

/** Chuẩn hóa thông tin thụ hưởng theo loại bút toán hiển thị. */
function getBeneficiaryByEntryType(entryType, vendor) {
  var normalizedType = normalizeEntryType(entryType);

  if (normalizedType === ENTRY_TYPE.CUSTOMER) {
    return {
      account: safeString(vendor && vendor.beneficiary_account).trim(),
      name: safeString(vendor && vendor.beneficiary_name).trim(),
      bank: safeString(vendor && vendor.beneficiary_bank).trim()
    };
  }

  if (normalizedType === ENTRY_TYPE.COST) {
    return { account: '', name: 'VietinBank', bank: '' };
  }

  // TAX, PAYABLE, PREPAYMENT và các loại còn lại không lấy thông tin NCC.
  return { account: '', name: '', bank: '' };
}

function applyBeneficiaryByEntryType(rows) {
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var beneficiary = getBeneficiaryByEntryType(list[i].entry_type, list[i]);
    list[i].beneficiary_account = beneficiary.account;
    list[i].beneficiary_name = beneficiary.name;
    list[i].beneficiary_bank = beneficiary.bank;
  }

  return list;
}

// -----------------------------------------------------------------------------
// SECTION 05F - ACCOUNT MAPPING: xác định tài khoản theo mã TT-BK
// -----------------------------------------------------------------------------

/**
 * Xác định tài khoản hạch toán cho từng dòng bút toán.
 *
 * TT-BK-01 (Cost)     : từ costDivision → truyền qua accountOverride, không vào đây.
 * TT-BK-02 (Tax)      : từ loại khấu trừ thuế (category item).
 * TT-BK-03 (Liability): TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-04 (Refund DR): TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-05 (Refund CR): TK tạm ứng khoản được chọn → truyền qua accountOverride.
 * TT-BK-06 (Payment)  : TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-07 (Suspended): TK phải trả NCC từ vendorSite.credit.account.
 * TT-BK-08 (Transfer) : TK thụ hưởng (chuyển khoản) hoặc TK tiền mặt.
 */
function resolveAccount(entryCode, vendor, taxInfo) {
  // TT-BK-02: Tài khoản thuế theo loại khấu trừ
  if (entryCode === AUTO_ENTRY_CODE.TAX) {
    return {
      number: taxInfo.accountNumber,
      name: taxInfo.accountName
    };
  }

  // ĐÃ CHỐT: tài khoản phải trả NCC = credit.account từ esdHTKTvendorSite.
  // TT-BK-03, TT-BK-04, TT-BK-06, TT-BK-07
  if (entryCode === AUTO_ENTRY_CODE.LIABILITY ||
      entryCode === AUTO_ENTRY_CODE.REFUND_DR ||
      entryCode === AUTO_ENTRY_CODE.PAYMENT ||
      entryCode === AUTO_ENTRY_CODE.SUSPENDED) {
    return {
      number: vendor.credit_account,
      name: getGlAccountName(vendor.credit_account)
    };
  }

  // TT-BK-08: Chuyển tiền
  if (entryCode === AUTO_ENTRY_CODE.TRANSFER) {
    if (isCashPayment(vendor.payment_method)) {
      return {
        number: CASH_CUSTOMER_ACCOUNT_NUMBER,
        name: CASH_CUSTOMER_ACCOUNT_NAME
      };
    }
    return {
      number: safeString(vendor.beneficiary_account).trim(),
      name: safeString(vendor.beneficiary_name).trim()
    };
  }

  return { number: '', name: '' };
}

// =============================================================================
// SECTION 06 - VALIDATE: tài khoản, số tiền và các trường DB bắt buộc
// =============================================================================

function getAutoEntryRowsErrors(rows) {
  var errors = [];

  for (var i = 0; i < rows.length; i++) {
    errors = errors.concat(getAutoEntryRowErrors(rows[i]));
  }

  return makeUniqueTextList(errors);
}

function getAutoEntryRowErrors(row) {
  var errors = [];
  var subject = row.entry_type ? 'Bút toán ' + row.entry_type : 'Bút toán tự động';
  var entryCode = safeString(row.rule_code).trim();
  var entryFields = [];
  var paymentVendorFields = [];
  var vendorSiteFields = [];
  var categoryItemFields = [];
  var costDivisionFields = [];

  if (!row.payment_id) entryFields.push('payment.id');
  if (!row.entry_type) entryFields.push('entry.type');
  if (!row.vendor_id) paymentVendorFields.push('vendor.id');
  if (!row.currency) paymentVendorFields.push('currency');

  if (!row.account_number) {
    if (entryCode === AUTO_ENTRY_CODE.COST) {
      costDivisionFields.push('account.number');
    } else if (entryCode === AUTO_ENTRY_CODE.TAX) {
      categoryItemFields.push('item.name (' + CATEGORY_TAX_ACCOUNT_NUMBER + ')');
    } else if (entryCode === AUTO_ENTRY_CODE.LIABILITY ||
               entryCode === AUTO_ENTRY_CODE.REFUND_DR ||
               entryCode === AUTO_ENTRY_CODE.PAYMENT ||
               entryCode === AUTO_ENTRY_CODE.SUSPENDED) {
      // Tài khoản phải trả NCC.
      vendorSiteFields.push('credit.account');
    } else if (entryCode === AUTO_ENTRY_CODE.REFUND_CR) {
      vendorSiteFields.push('debit.account');
    } else if (entryCode === AUTO_ENTRY_CODE.TRANSFER && !isCashPayment(row.payment_method)) {
      paymentVendorFields.push('beneficiary.account');
    } else {
      errors.push(subject + ': không xác định được tài khoản.');
    }
  }

  addMissingFieldsError(errors, subject, TABLE_PAYMENT_ENTRY, entryFields);
  addMissingFieldsError(errors, subject, TABLE_PAYMENT_VENDOR, paymentVendorFields);
  addMissingFieldsError(errors, subject, TABLE_VENDOR_SITE, vendorSiteFields);
  addMissingFieldsError(errors, subject, TABLE_CATEGORY_ITEM, categoryItemFields);
  addMissingFieldsError(errors, subject, TABLE_COST_DIVISION, costDivisionFields);

  var amountIsBlank = row.amount === null || row.amount === undefined || row.amount === '';
  if (!(row.allow_blank_amount && amountIsBlank) && toNumber(row.amount) <= 0) {
    errors.push(subject + ': số tiền phải lớn hơn 0.');
  }

  return errors;
}

// -----------------------------------------------------------------------------
// SECTION 06A - VALIDATE NCC: kiểm tra dữ liệu trước khi chia case
// -----------------------------------------------------------------------------

function getVendorAutoEntryErrors(vendor) {
  var errors = [];
  var subject = vendor.vendor_id ? 'NCC ' + vendor.vendor_id : 'NCC';
  var paymentVendorFields = [];
  var vendorFields = [];
  var vendorSiteFields = [];

  if (!vendor.vendor_id) paymentVendorFields.push('vendor.id');
  if (!vendor.vendor_site_id) paymentVendorFields.push('vendor.site.id');
  if (!vendor.currency) paymentVendorFields.push('currency');
  if (toNumber(vendor.amount) > 0 && !vendor.payment_method) paymentVendorFields.push('payment.method');
  if (!vendor.vendor_number) vendorFields.push('vendor.number');
  // ogl.site.code chi bat buoc tai buoc mapping/call API, khong chan sinh but toan.
  // Khong bat buoc credit.account o cap NCC; validate theo dong tu sinh thuc te.
  // Không yêu cầu debit.account chỉ vì có refund.amount: paymentEntry chưa sinh
  // dòng Có TK tạm ứng; tài khoản này được kiểm tra ở bước xử lý tab Công nợ.

  // Chỉ bắt buộc thông tin thụ hưởng khi case thực sự có đi tiền.
  if (toNumber(vendor.amount) > 0 && isBankTransfer(vendor.payment_method)) {
    if (!vendor.beneficiary_account) paymentVendorFields.push('beneficiary.account');
    if (!vendor.beneficiary_name) paymentVendorFields.push('beneficiary.name');
    if (!vendor.beneficiary_bank) paymentVendorFields.push('beneficiary.bank');
  }

  addMissingFieldsError(errors, subject, TABLE_PAYMENT_VENDOR, paymentVendorFields);
  addMissingFieldsError(errors, subject, TABLE_VENDOR, vendorFields);
  addMissingFieldsError(errors, subject, TABLE_VENDOR_SITE, vendorSiteFields);

  return errors;
}

// =============================================================================
// SECTION 04C - READ INVOICE / TAX: dữ liệu phục vụ phân case
// =============================================================================

/** Kiểm tra NCC có hóa đơn mới đính kèm trong phiếu thanh toán hay không. */
function hasLinkedInvoicesForVendor(paymentId, vendor, vendorCount) {
  var links = getLinkedInvoices(paymentId);

  for (var i = 0; i < links.length; i++) {
    var invoice = getInvoiceById(links[i].invoice_id);
    if (isInvoiceForVendor(invoice, vendor, vendorCount)) return true;
  }

  return false;
}

/**
 * Tính tổng thuế của các hóa đơn gắn với payment theo logic bút toán tạm ứng:
 * - Số tiền thuế từng hóa đơn lấy từ esdHTKTinvoice.total.tax.
 * - deduction.type tại esdHTKTpaymentInvoice chỉ xác định loại khấu trừ
 *   và tài khoản ghi Nợ của dòng TT-BK-02.
 * - deduction.amount và deduction.rate là dữ liệu nghiệp vụ đã lưu từ hóa đơn,
 *   nhưng không dùng để thay thế invoice.total.tax khi sinh dòng thuế.
 *
 * Nếu payment có nhiều NCC, hàm được gọi theo từng NCC. Tổng thuế của toàn bộ
 * lần hạch toán bằng tổng total.tax của tất cả hóa đơn hợp lệ gắn với payment.
 */
function getInvoiceTaxInfo(paymentId, vendor, vendorCount) {
  var links = getLinkedInvoices(paymentId);
  var taxAmounts = {};
  var deductionTypes = [DEDUCTION_TYPE_FULL, DEDUCTION_TYPE_RATE];
  var result = {
    totalDeductibleTax: 0,
    hasDeductibleTax: false,
    groups: [],
    errors: []
  };

  taxAmounts[DEDUCTION_TYPE_FULL] = 0;
  taxAmounts[DEDUCTION_TYPE_RATE] = 0;

  for (var i = 0; i < links.length; i++) {
    var invoice = getInvoiceById(links[i].invoice_id);
    if (!isInvoiceForVendor(invoice, vendor, vendorCount)) continue;

    // Khấu trừ toàn bộ lấy nguyên total.tax; khấu trừ tỷ lệ nhân exchange.rate,
    // trong đó tỷ lệ được chặn trong khoảng 0..1.
    var taxAmount = toNumber(invoice.total_tax);
    if (taxAmount <= 0) continue;

    var deductionType = links[i].deduction_type;
    if (!deductionType) {
      result.errors.push('Hóa đơn ' + links[i].invoice_id + ': thiếu deduction.type tại ' + TABLE_PAYMENT_INVOICE + '.');
      continue;
    }

    var deductionTypeCode = safeString(deductionType).trim().toUpperCase();
    if (deductionTypeCode === DEDUCTION_TYPE_NONE) continue;

    if (deductionTypeCode !== DEDUCTION_TYPE_FULL && deductionTypeCode !== DEDUCTION_TYPE_RATE) {
      result.errors.push('Hóa đơn ' + links[i].invoice_id + ': deduction.type không hợp lệ (' + deductionType + ').');
      continue;
    }

    if (deductionTypeCode === DEDUCTION_TYPE_RATE) {
      var deductionRate = Math.max(0, Math.min(1, toNumber(invoice.exchange_rate)));
      taxAmount = taxAmount * deductionRate;
      debugPaymentEntry('TAX-RATE', 'Hóa đơn ' + links[i].invoice_id + ': totalTax=' + invoice.total_tax + ', exchangeRate=' + deductionRate + ', deductibleTax=' + taxAmount);
    }

    // Gom số thuế được khấu trừ theo loại để sinh đúng tài khoản TT-BK-02.
    taxAmounts[deductionTypeCode] += taxAmount;
  }

  for (var typeIndex = 0; typeIndex < deductionTypes.length; typeIndex++) {
    var deductionTypeCode = deductionTypes[typeIndex];
    var groupedTaxAmount = taxAmounts[deductionTypeCode];
    if (groupedTaxAmount <= 0) continue;

    var taxAccount = getTaxDeductionAccount(deductionTypeCode);
    result.groups.push({
      deductionType: deductionTypeCode,
      amount: groupedTaxAmount,
      accountNumber: taxAccount.number,
      accountName: taxAccount.name
    });
    result.totalDeductibleTax += groupedTaxAmount;
    if (taxAccount.error) result.errors.push(taxAccount.error);
  }

  result.hasDeductibleTax = result.groups.length > 0;

  result.errors = makeUniqueTextList(result.errors);

  return result;
}

function getTaxDeductionAccount(deductionType) {
  var itemId = safeString(deductionType).trim();
  var deductionItem = null;
  var accountItem = null;
  var accountNumber = '';
  var accountName = '';
  var error = '';

  if (!itemId) {
    error = 'Thiếu deduction.type tại ' + TABLE_PAYMENT_INVOICE + '.';
  } else {
    deductionItem = selectOne(
      TABLE_CATEGORY_ITEM,
      'category.id="' + escapeQueryValue(CATEGORY_TAX_DEDUCTION_TYPE) + '" and item.id="' + escapeQueryValue(itemId) + '"',
      function (record) {
        return {
          itemId: readText(record, 'item.id'),
          itemName: readText(record, 'item.name')
        };
      }
    );

    if (!deductionItem) {
      error = 'Loại khấu trừ ' + itemId + ': không có dữ liệu tại ' + TABLE_CATEGORY_ITEM + ' (' + CATEGORY_TAX_DEDUCTION_TYPE + ').';
    } else {
      accountName = deductionItem.itemName;
      accountItem = selectOne(
        TABLE_CATEGORY_ITEM,
        'category.id="' + escapeQueryValue(CATEGORY_TAX_ACCOUNT_NUMBER) + '" and item.id="' + escapeQueryValue(deductionItem.itemId) + '"',
        function (record) {
          return { itemName: readText(record, 'item.name') };
        }
      );
      accountNumber = accountItem ? accountItem.itemName : '';

      if (!accountName) {
        error = 'Loại khấu trừ ' + itemId + ': thiếu item.name tại ' + TABLE_CATEGORY_ITEM + ' (' + CATEGORY_TAX_DEDUCTION_TYPE + ').';
      } else if (!accountNumber) {
        error = 'Loại khấu trừ ' + itemId + ': thiếu item.name tại ' + TABLE_CATEGORY_ITEM + ' (' + CATEGORY_TAX_ACCOUNT_NUMBER + ').';
      }
    }
  }

  return {
    number: accountNumber,
    name: accountName,
    error: error
  };
}

function getLinkedInvoices(paymentId) {
  var list = [];
  var objectRows = selectObjectRows(TABLE_PAYMENT_INVOICE, { 'payment.id': paymentId });
  if (objectRows !== null) {
    for (var objectIndex = 0; objectIndex < objectRows.length; objectIndex++) {
      var objectInvoiceId = readText(objectRows[objectIndex], 'invoice.id');
      if (!objectInvoiceId) continue;
      list.push({
        invoice_id: objectInvoiceId,
        deduction_type: readText(objectRows[objectIndex], 'deduction.type'),
        deduction_amount: readNumber(objectRows[objectIndex], 'deduction.amount'),
        deduction_rate: readNumber(objectRows[objectIndex], 'deduction.rate')
      });
    }
    return list;
  }

  var f = new SCFile(TABLE_PAYMENT_INVOICE, SCFILE_READONLY);
  var rc;

  try {
    rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');
  } catch (e) {
    closeFile(f);
    return list;
  }

  while (rc === RC_SUCCESS) {
    var invoiceId = readText(f, 'invoice.id');

    if (invoiceId) {
      list.push({
        invoice_id: invoiceId,
        deduction_type: readText(f, 'deduction.type'),
        deduction_amount: readNumber(f, 'deduction.amount'),
        deduction_rate: readNumber(f, 'deduction.rate')
      });
    }

    rc = f.getNext();
  }

  closeFile(f);
  return list;
}

function isInvoiceForVendor(invoice, vendor, vendorCount) {
  var sellerTaxCode = normalizeIdentity(invoice.seller_tax_code);
  var vendorTaxCode = normalizeIdentity(vendor.vendor_number);

  if (sellerTaxCode && vendorTaxCode) return sellerTaxCode === vendorTaxCode;

  return vendorCount <= 1;
}

/** Kiểm tra MST hóa đơn khớp ít nhất một NCC trong đề nghị. */
function getLinkedInvoiceVendorErrors(paymentId, vendors) {
  var links = getLinkedInvoices(paymentId);
  var errors = [];

  for (var i = 0; i < links.length; i++) {
    var invoice = getInvoiceById(links[i].invoice_id);
    var sellerTaxCode = normalizeIdentity(invoice.seller_tax_code);
    var matched = false;

    for (var vendorIndex = 0; vendorIndex < vendors.length; vendorIndex++) {
      var vendorTaxCode = normalizeIdentity(vendors[vendorIndex].vendor_number);
      if (sellerTaxCode && vendorTaxCode && sellerTaxCode === vendorTaxCode) {
        matched = true;
        break;
      }
    }

    if (!sellerTaxCode) {
      errors.push('Hóa đơn ' + links[i].invoice_id + ': thiếu seller.tax.code tại ' + TABLE_INVOICE + '.');
    } else if (!matched) {
      errors.push('Hóa đơn ' + links[i].invoice_id + ': seller.tax.code không khớp vendor.number của NCC.');
    }
  }

  return makeUniqueTextList(errors);
}

function getInvoiceById(invoiceId) {
  if (!invoiceId) return {};

  return (
      selectOne(TABLE_INVOICE, 'id="' + escapeQueryValue(invoiceId) + '"', function (record) {
      return {
        id: readText(record, 'id'),
        total_tax: readNumber(record, 'total.tax'),
        exchange_rate: readNumber(record, 'exchange.rate'),
        seller_tax_code: readText(record, 'seller.tax.code')
      };
    }) || {}
  );
}

// -----------------------------------------------------------------------------
// SECTION 04D - READ COST DIVISION: dữ liệu phục vụ sinh bút toán
// -----------------------------------------------------------------------------

/**
 * Đọc các dòng phân bổ chi phí từ bảng esdHTKTpaymentCostDivision.
 * Mỗi dòng phân bổ tương ứng 1 dòng TT-BK-01.
 */
function getPaymentCostDivisions(paymentId, vendorId) {
  var list = [];
  var criteria = { 'payment.id': paymentId };
  if (vendorId) criteria['vendor.id'] = vendorId;
  var objectRows = selectObjectRows(TABLE_COST_DIVISION, criteria);

  if (objectRows !== null) {
    for (var objectIndex = 0; objectIndex < objectRows.length; objectIndex++) {
      var objectRow = objectRows[objectIndex];
      list.push({
        id: readText(objectRow, 'id'),
        payment_id: readText(objectRow, 'payment.id'),
        account_number: readText(objectRow, 'account.number'),
        account_name: readText(objectRow, 'account.name'),
        amount: readNumber(objectRow, 'amount'),
        currency: readText(objectRow, 'currency'),
        department: readText(objectRow, 'department'),
        department_name: readText(objectRow, 'department.name'),
        branch: readText(objectRow, 'branch'),
        description: readText(objectRow, 'description'),
        vendor_id: readText(objectRow, 'vendor.id'),
        order: readNumber(objectRow, 'order')
      });
    }
    return list;
  }

  var f = new SCFile(TABLE_COST_DIVISION, SCFILE_READONLY);
  // ĐÃ CHỐT: lọc theo cả payment.id và vendor.id.
  // Hiện giả định: lọc theo cả payment.id + vendor.id.
  var query = 'payment.id="' + escapeQueryValue(paymentId) + '"';
  if (vendorId) query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';

  var rc;

  try {
    rc = f.doSelect(query);
  } catch (e) {
    closeFile(f);
    return list;
  }

  while (rc === RC_SUCCESS) {
    list.push({
      id: readText(f, 'id'),
      payment_id: readText(f, 'payment.id'),
      account_number: readText(f, 'account.number'),
      account_name: readText(f, 'account.name'),
      amount: readNumber(f, 'amount'),
      currency: readText(f, 'currency'),
      department: readText(f, 'department'),
      department_name: readText(f, 'department.name'),
      branch: readText(f, 'branch'),
      description: readText(f, 'description'),
      vendor_id: readText(f, 'vendor.id'),
      order: readNumber(f, 'order')
    });

    rc = f.getNext();
  }

  closeFile(f);
  return list;
}

// =============================================================================
// SECTION 04E - READ SOURCE DATA: phiếu thanh toán, NCC và Vendor Site
// =============================================================================

function getPaymentRequest(paymentId) {
  if (!paymentId) return {};

  return (
    selectOne(TABLE_PAYMENT, 'id="' + escapeQueryValue(paymentId) + '"', function (record) {
      return {
        id: readText(record, 'id'),
        department: readText(record, 'department'),
        description: readText(record, 'description'),
        current_phase: readText(record, 'current.phase'),
        user_checker_kttc: readText(record, 'user.checker.kttc'),
        initial_role: readText(record, 'initial.role'),
        created_by: readText(record, 'created.by'),
        total_advance_amount: readNumber(record, 'total.advance.amount'),
        total_amount_paid: readNumber(record, 'total.amount.paid'),
        total_refund_amount: readNumber(record, 'total.refund.amount'),
        currency: readText(record, 'currentcy')
      };
    }) || {}
  );
}

function getPaymentVendors(paymentId, vendorId) {
  var list = [];
  var criteria = { 'payment.id': paymentId };
  if (vendorId) criteria['vendor.id'] = vendorId;
  var objectRows = selectObjectRows(TABLE_PAYMENT_VENDOR, criteria);

  if (objectRows !== null) {
    for (var objectIndex = 0; objectIndex < objectRows.length; objectIndex++) {
      var objectRow = objectRows[objectIndex];
      list.push({
        vendor_id: readText(objectRow, 'vendor.id'),
        vendor_site_id: readText(objectRow, 'vendor.site.id'),
        approved_invoice_amount: readNumber(objectRow, 'approved.invoice.amount'),
        amount: readNumber(objectRow, 'amount'),
        refund_amount: readNumber(objectRow, 'refund.amount'),
        vendor_type: readText(objectRow, 'vendor.type'),
        currency: readText(objectRow, 'currency'),
        payment_method: readText(objectRow, 'payment.method'),
        beneficiary_account: readText(objectRow, 'beneficiary.account'),
        beneficiary_name: readText(objectRow, 'beneficiary.name'),
        beneficiary_bank: readText(objectRow, 'beneficiary.bank'),
        exchange_rate: readText(objectRow, 'exchange.rate'),
        payment_rate: readNumber(objectRow, 'payment.rate')
      });
    }
    return list;
  }

  var f = new SCFile(TABLE_PAYMENT_VENDOR, SCFILE_READONLY);
  var query = 'payment.id="' + escapeQueryValue(paymentId) + '"';
  var rc;

  if (vendorId) query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';

  try {
    rc = f.doSelect(query);
  } catch (e) {
    closeFile(f);
    return list;
  }

  while (rc === RC_SUCCESS) {
    list.push({
      vendor_id: readText(f, 'vendor.id'),
      vendor_site_id: readText(f, 'vendor.site.id'),
      approved_invoice_amount: readNumber(f, 'approved.invoice.amount'),
      amount: readNumber(f, 'amount'),
      refund_amount: readNumber(f, 'refund.amount'),
      vendor_type: readText(f, 'vendor.type'),
      currency: readText(f, 'currency'),
      payment_method: readText(f, 'payment.method'),
      beneficiary_account: readText(f, 'beneficiary.account'),
      beneficiary_name: readText(f, 'beneficiary.name'),
      beneficiary_bank: readText(f, 'beneficiary.bank'),
      exchange_rate: readText(f, 'exchange.rate'),
      payment_rate: readNumber(f, 'payment.rate')
    });

    rc = f.getNext();
  }

  closeFile(f);
  return list;
}

function enrichVendor(vendor) {
  var vendorInfo = getVendorInfo(vendor.vendor_id);
  var siteInfo = getVendorSiteInfo(vendor.vendor_site_id);

  vendor.vendor_name = vendorInfo.vendor_name;
  vendor.vendor_number = vendorInfo.vendor_number;
  vendor.vendor_site_code = siteInfo.vendor_site_code;
  vendor.debit_account = siteInfo.debit_account;
  vendor.credit_account = siteInfo.credit_account;

  return vendor;
}

function getVendorInfo(vendorId) {
  if (!vendorId) return {};

  return (
    selectOne(
      TABLE_VENDOR,
      'id="' + escapeQueryValue(vendorId) + '"',
      function (record) {
        return {
          vendor_name: readText(record, 'vendor.name'),
          vendor_number: readText(record, 'vendor.number')
        };
      }
    ) || {}
  );
}

function getVendorSiteInfo(vendorSiteId) {
  if (!vendorSiteId) return {};

  return (
    selectOne(
      TABLE_VENDOR_SITE,
      'id="' + escapeQueryValue(vendorSiteId) + '"',
      function (record) {
        return {
          vendor_site_code: readText(record, 'ogl.site.code'),
          debit_account: extractAccountNumber(readText(record, 'debit.account')),
          credit_account: extractAccountNumber(readText(record, 'credit.account'))
        };
      }
    ) || {}
  );
}

// =============================================================================
// SECTION 07 - PERSISTENCE / SAVE DB: đọc, merge, xóa và insert paymentEntry
// =============================================================================

/** Đọc entry cùng thông tin NCC bằng LEFT JOIN. */
function getSavedPaymentEntries(paymentId) {
  var fields = getPaymentEntryFields();
  var sql =
    'SELECT ' +
    selectFields(fields) +
    ' FROM ' +
    TABLE_PAYMENT_ENTRY +
    ' e LEFT JOIN ' +
    TABLE_PAYMENT_VENDOR +
    ' pv ON (e.payment.id = pv.payment.id AND e.vendor.id = pv.vendor.id)' +
    ' LEFT JOIN ' +
    TABLE_VENDOR +
    ' v ON (e.vendor.id = v.id)' +
    ' LEFT JOIN ' +
    TABLE_VENDOR_SITE +
    ' vs ON (pv.vendor.site.id = vs.id)' +
    ' WHERE e.payment.id="' +
    escapeQueryValue(paymentId) +
    '" ORDER BY e.order ASC';

  return applyBeneficiaryByEntryType(selectList(TABLE_PAYMENT_ENTRY, sql, fields));
}

function getPaymentEntryFields() {
  return [
    ['e.id', 'id', 'S'],
    ['e.payment.id', 'payment_id', 'S'],
    ['e.entry.type', 'entry_type', 'S'],
    ['e.ledger.type', 'ledger_type', 'S'],
    ['e.account.type', 'account_type', 'S'],
    ['e.account.number', 'account_number', 'S'],
    ['e.account.name', 'account_name', 'S'],
    ['e.branch', 'branch', 'S'],
    ['e.department', 'department', 'S'],
    ['e.transaction.code', 'transaction_office', 'S'],
    ['e.amount', 'amount', 'N?'],
    ['e.currency', 'currency', 'S'],
    ['e.description', 'description', 'S'],
    ['e.vendor.id', 'vendor_id', 'S'],
    ['v.vendor.name', 'vendor_name', 'S'],
    ['e.type', 'type', 'S'],
    ['e.order', 'order', 'N'],
    ['e.accounting.request.id', 'accounting_request_id', 'S'],
    ['pv.vendor.site.id', 'vendor_site_id', 'S'],
    ['vs.ogl.site.code', 'vendor_site_code', 'S'],
    ['pv.payment.method', 'payment_method', 'S'],
    ['pv.beneficiary.account', 'beneficiary_account', 'S'],
    ['pv.beneficiary.name', 'beneficiary_name', 'S'],
    ['pv.beneficiary.bank', 'beneficiary_bank', 'S']
  ];
}

/** Giữ description và tài khoản chi phí người dùng đã sửa khi sinh lại. */
function mergeEditableAutoEntryFields(savedEntries, expectedEntries) {
  var savedMap = {};
  var result = [];

  // Gom các dòng đã lưu theo NCC và loại bút toán; thứ tự trong nhóm phân biệt các dòng cùng loại.
  for (var i = 0; i < savedEntries.length; i++) {
    var saved = savedEntries[i];
    if (!isAutoEntry(saved)) continue;

    var savedEntryKey = makeAutoEntryMatchKey(saved);
    if (!savedEntryKey) continue;

    if (!savedMap[savedEntryKey]) savedMap[savedEntryKey] = [];
    savedMap[savedEntryKey].push(saved);
  }

  // Giữ ID và các trường được phép chỉnh sửa của dòng tương ứng.
  for (var j = 0; j < expectedEntries.length; j++) {
    var expected = copyObject({}, expectedEntries[j]);
    var expectedEntryKey = makeAutoEntryMatchKey(expected);
    var matches = savedMap[expectedEntryKey] || [];
    var matched = matches.length > 0 ? matches.shift() : null;

    if (matched) {
      expected.id = safeString(matched.id);
      expected.description = safeString(matched.description).trim() || expected.description;

      // Giữ tài khoản chi phí (TT-BK-01) nếu người dùng đã sửa
      if (isEditableDebitAccountEntry(expected)) {
        var generatedAccountNumber = safeString(expected.account_number);
        var savedAccountNumber = safeString(matched.account_number);
        expected.account_number = savedAccountNumber;
        expected.account_name =
          savedAccountNumber === generatedAccountNumber
            ? expected.account_name
            : getGlAccountName(savedAccountNumber);
      }
    }

    result.push(expected);
  }

  return result;
}

function makeAutoEntryMatchKey(row) {
  var entryType = normalizeEntryType(row.entry_type);
  if (!entryType) return '';

  var key = safeString(row.vendor_id).trim() + '|' + entryType;

  if (entryType === ENTRY_TYPE.COST || entryType === ENTRY_TYPE.TAX) {
    key += '|' + safeString(row.account_number).trim();
  }

  // Hoàn ứng được phân biệt theo vendor.id; số tiền lấy từ vendor.refund.amount.
  // if (entryCode === AUTO_ENTRY_CODE.REFUND_DR || entryCode === AUTO_ENTRY_CODE.REFUND_CR) {
  //   key += '|' + safeString(row.account_number).trim();
  // }

  return key;
}

function isEditableDebitAccountEntry(row) {
  return normalizeEntryType(row.entry_type) === ENTRY_TYPE.COST;
}

/**
 * SAVE AUTO:
 * Chỉ xóa dòng tự động của phiếu, giữ dòng bổ sung của người dùng, rồi insert lại.
 */
function replaceAutoPaymentEntries(paymentId, rows) {
  var deleted = deleteAutoPaymentEntries(paymentId);
  var inserted = insertPaymentEntries(rows);

  return {
    inserted: inserted,
    updated: 0,
    deleted: deleted
  };
}

/** SAVE INSERT: ghi danh sách dòng đã validate vào esdHTKTpaymentEntry. */
function insertPaymentEntries(rows) {
  var inserted = 0;

  for (var i = 0; i < rows.length; i++) {
    if (insertRecord(TABLE_PAYMENT_ENTRY, toPaymentEntryRecord(rows[i])) === RC_SUCCESS) inserted++;
  }

  return inserted;
}

function toPaymentEntryRecord(row) {
  return {
    id: row.id,
    'payment.id': row.payment_id,
    'entry.type': row.entry_type,
    'ledger.type': row.ledger_type,
    'account.type': row.account_type,
    'account.number': row.account_number,
    'account.name': row.account_name,
    branch: row.branch,
    department: row.department,
    'transaction.code': row.transaction_office,
    amount: row.amount,
    currency: row.currency,
    description: row.description,
    'vendor.id': row.vendor_id,
    type: row.type,
    order: row.order,
    'accounting.request.id': row.accounting_request_id
  };
}

function insertRecord(tableName, row) {
  var f = new SCFile(tableName);

  for (var key in row) {
    if (row.hasOwnProperty(key)) f[key] = row[key];
  }

  var rc = f.doInsert();
  closeFile(f);
  return rc;
}

function deleteAutoPaymentEntries(paymentId) {
  var deleted = 0;
  var f = new SCFile(TABLE_PAYMENT_ENTRY);
  var rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');

  while (rc === RC_SUCCESS) {
    if (isAutoEntry({ type: f['type'] })) {
      if (f.doDelete() === RC_SUCCESS) deleted++;
    }

    rc = f.getNext();
  }

  closeFile(f);
  return deleted;
}

/** SAVE EDIT: xóa toàn bộ dòng của phiếu trước khi lưu danh sách người dùng sửa. */
function deletePaymentEntries(paymentId) {
  var deleted = 0;
  var f = new SCFile(TABLE_PAYMENT_ENTRY);
  var rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');

  while (rc === RC_SUCCESS) {
    if (f.doDelete() === RC_SUCCESS) deleted++;
    rc = f.getNext();
  }

  closeFile(f);
  return deleted;
}

// =============================================================================
// SUPPORT - PHASE / PERMISSION: khóa sinh hoặc giới hạn quyền chỉnh sửa
// =============================================================================

function isGenerationPhaseLocked(currentPhase) {
  var phase = normalizeText(currentPhase);
  return phase !== GENERATION_PHASE.DMMS && phase !== GENERATION_PHASE.KTTC;
}

function isAccountingEditablePhase(currentPhase) {
  return normalizeText(currentPhase) === GENERATION_PHASE.KTTC;
}

function getCurrentOperatorName() {
  var currentOperator = vars.$lo_operator;
  return currentOperator ? safeString(currentOperator['contact.name']).trim() : '';
}

function isSameUser(expectedUser, currentUser) {
  var expected = safeString(expectedUser).trim();
  var actual = safeString(currentUser).trim();
  return !!expected && !!actual && normalizeText(expected) === normalizeText(actual);
}

function isAutoEntry(row) {
  if (normalizeText(row.type) === normalizeText(TYPE.GL)) return false;
  if (normalizeEntryType(row.entry_type) === ENTRY_TYPE.PREPAYMENT) return false;
  if (isUserAddedEntryId(row.id)) return false;
  return true;
}

// =============================================================================
// SUPPORT - ID GENERATION: sinh ID tuần tự cho dòng mới
// =============================================================================

function assignNewEntryIds(paymentId, rows, savedEntries) {
  var nextApSequence = getNextEntryIdSequence(paymentId, TYPE.AP, savedEntries);
  var nextGlRowSequence = getNextGlRowSequence(paymentId, 1, savedEntries);

  for (var i = 0; i < rows.length; i++) {
    if (!safeString(rows[i].id).trim()) {
      if (isAdditionalEntryType(rows[i].type)) {
        rows[i].id = makeGlEntryId(paymentId, 1, nextGlRowSequence++);
      } else {
        rows[i].id = makeSequentialEntryId(paymentId, TYPE.AP, nextApSequence++);
      }
    }
  }
}

function getNextEntryIdSequence(paymentId, entryType, rows) {
  if (entryType === TYPE.GL) return getNextGlRowSequence(paymentId, 1, rows);
  var prefix = getEntryIdPrefix(paymentId, entryType);
  var maxSequence = 0;
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var id = safeString(list[i].id).trim();
    if (id.indexOf(prefix) !== 0) continue;

    var suffix = id.substring(prefix.length);
    if (!/^\d+$/.test(suffix)) continue;

    var sequence = Number(suffix);
    if (sequence > maxSequence) maxSequence = sequence;
  }

  return maxSequence + 1;
}

function makeSequentialEntryId(paymentId, entryType, sequence) {
  if (entryType === TYPE.GL) return makeGlEntryId(paymentId, 1, sequence);
  return getEntryIdPrefix(paymentId, entryType) + sequence;
}

function makeUserAddedEntryId(paymentId, sequence) {
  return safeString(paymentId).trim() + '.MANUAL.AP.' + sequence;
}

function isUserAddedEntryId(entryId) {
  return safeString(entryId).indexOf('.MANUAL.AP.') >= 0;
}

function getNextManualEntryIdSequence(paymentId, rows) {
  var prefix = safeString(paymentId).trim() + '.MANUAL.AP.';
  var maxSequence = 0;
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var id = safeString(list[i].id).trim();
    if (id.indexOf(prefix) !== 0) continue;
    var suffix = id.substring(prefix.length);
    if (/^\d+$/.test(suffix) && Number(suffix) > maxSequence) {
      maxSequence = Number(suffix);
    }
  }

  return maxSequence + 1;
}

function getEntryIdPrefix(paymentId, entryType) {
  var prefix = safeString(paymentId).trim() + '.';
  return entryType === TYPE.GL ? prefix + TYPE.GL + '.' : prefix;
}

function makeGlEntryId(paymentId, groupOrder, rowOrder) {
  return getEntryIdPrefix(paymentId, TYPE.GL) + groupOrder + '.' + rowOrder;
}

function getGlEntryIdParts(paymentId, entryId) {
  var prefix = getEntryIdPrefix(paymentId, TYPE.GL);
  var id = safeString(entryId).trim();
  if (id.indexOf(prefix) !== 0) return null;
  var parts = id.substring(prefix.length).split('.');
  if (parts.length === 2 && /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) &&
      Number(parts[0]) > 0 && Number(parts[1]) > 0) {
    return { groupOrder: Number(parts[0]), rowOrder: Number(parts[1]) };
  }
  return null;
}

function isStructuredGlEntryId(paymentId, entryId) {
  return !!getGlEntryIdParts(paymentId, entryId);
}

function getNextGlRowSequence(paymentId, groupOrder, rows) {
  var max = 0;
  var list = rows || [];
  for (var i = 0; i < list.length; i++) {
    var parts = getGlEntryIdParts(paymentId, list[i].id);
    if (parts && parts.groupOrder === groupOrder && parts.rowOrder > max) max = parts.rowOrder;
  }
  return max + 1;
}

function normalizeGlBranchCode(value) {
  var code = safeString(value).replace(/\s+/g, '').trim();
  if (!/^[0-9]+$/.test(code)) return '';
  while (code.length > 3 && code.charAt(0) === '0') code = code.substring(1);
  if (code.length > 3) return '';
  while (code.length < 3) code = '0' + code;
  return code;
}

function getGlBranchCodeByEntityCode(entityCode) {
  var code = safeString(entityCode).trim();
  if (!code) return '';
  return selectOne(
    TABLE_ENTITY,
    'entity.code="' + escapeQueryValue(code) +
      '" and org.transaction.code="' + escapeQueryValue(GL_UNIT_TRANSACTION_CODE) + '"',
    function (record) {
      return normalizeGlBranchCode(readText(record, 'ogl.branch.code'));
    }
  ) || '';
}

function makeEntryIdSet(rows) {
  var result = {};
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var id = safeString(list[i].id).trim();
    if (id) result[id] = true;
  }

  return result;
}

// =============================================================================
// SUPPORT - QUERY HELPERS: wrapper đọc SCFile / SQL
// =============================================================================

function isBankTransfer(value) {
  return normalizeBusinessText(value).replace(/\s+/g, '') === 'chuyenkhoan';
}

function isCashPayment(value) {
  return normalizeBusinessText(value).replace(/\s+/g, '') === 'tienmat';
}

function selectOne(tableName, query, mapper) {
  var f;
  var rc;
  var objectRows = getObjectTableRows(tableName);

  if (objectRows !== null) {
    var criteria = parseSimpleObjectQuery(query);
    var matches = selectObjectRows(tableName, criteria);
    return matches.length > 0 ? mapper(matches[0]) : null;
  }

  try {
    f = new SCFile(tableName, SCFILE_READONLY);
    rc = f.doSelect(query);
  } catch (e) {
    closeFile(f);
    return null;
  }

  var result = rc === RC_SUCCESS ? mapper(f) : null;
  closeFile(f);
  return result;
}

/**
 * Parser tối giản cho các query dạng:
 * field="value" and other.field="value"
 * Đây là toàn bộ dạng query selectOne đang dùng trong luồng sinh object.
 */
function parseSimpleObjectQuery(query) {
  var criteria = {};
  var pattern = /([a-zA-Z0-9_.]+)\s*=\s*"((?:\\"|[^"])*)"/g;
  var match;

  while ((match = pattern.exec(safeString(query))) !== null) {
    criteria[match[1]] = match[2].replace(/\\"/g, '"');
  }

  return criteria;
}

function selectList(tableName, sql, fields) {
  var list = [];
  var f = new SCFile(tableName, SCFILE_READONLY);
  var rc = f.doSelect(sql);

  while (rc === RC_SUCCESS) {
    list.push(mapSqlRow(f, fields));
    rc = f.getNext();
  }

  closeFile(f);
  return list;
}

function mapSqlRow(record, fields) {
  var item = {};

  for (var i = 0; i < fields.length; i++) {
    var key = fields[i][1];
    var type = fields[i][2];
    var value = record[i];
    if (type === 'N?') {
      item[key] = value === null || value === undefined || value === '' ? null : toNumber(value);
    } else {
      item[key] = type === 'N' ? toNumber(value) : safeString(value);
    }
  }

  return item;
}

function selectFields(fields) {
  var items = [];

  for (var i = 0; i < fields.length; i++) {
    items.push(fields[i][0]);
  }

  return items.join(', ');
}

// =============================================================================
// SUPPORT - UTILITIES: xử lý chuỗi, số, field và đóng file
// =============================================================================

function addMissingFieldsError(errors, subject, tableName, fields) {
  if (fields.length === 0) return;
  errors.push(subject + ': thiếu ' + fields.join(', ') + ' tại ' + tableName + '.');
}

function makeUniqueTextList(values) {
  var map = {};
  var list = [];

  for (var i = 0; i < values.length; i++) {
    var value = safeString(values[i]).trim();
    if (!value || map[value]) continue;

    map[value] = true;
    list.push(value);
  }

  return list;
}

/**
 * Chuẩn hóa số tài khoản từ vendor site.
 * Dạng mới: lấy đoạn giữa dấu chấm thứ hai và thứ ba; dạng cũ giữ nguyên.
 */
function extractAccountNumber(value) {
  var account = safeString(value).trim();
  var firstDot = account.indexOf('.');
  var secondDot = firstDot >= 0 ? account.indexOf('.', firstDot + 1) : -1;
  var thirdDot = secondDot >= 0 ? account.indexOf('.', secondDot + 1) : -1;

  if (secondDot < 0 || thirdDot < 0) return account;

  var extracted = account.substring(secondDot + 1, thirdDot).trim();
  return extracted || account;
}

function readText(record, fieldName) {
  var value = readField(record, fieldName);
  return value === null || value === undefined ? '' : safeString(value);
}

function readNumber(record, fieldName) {
  return toNumber(readField(record, fieldName));
}

function readField(record, fieldName) {
  try {
    return record[fieldName];
  } catch (e) {
    return null;
  }
}

function toNumber(value) {
  if (value === null || value === undefined || value === '') return 0;
  var numberValue = Number(String(value).replace(/,/g, '').replace(/%/g, '').trim());
  return isNaN(numberValue) ? 0 : numberValue;
}

function safeString(value) {
  if (value === null || value === undefined) return '';
  return String(value);
}

function normalizeText(value) {
  var text = safeString(value).toLowerCase();

  try {
    if (text.normalize) text = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  } catch (e) {}

  return text
    .replace(/\u0111/g, 'd')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeBusinessText(value) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

function normalizeIdentity(value) {
  return normalizeText(value).replace(/[^a-z0-9]/g, '');
}

function escapeQueryValue(value) {
  return safeString(value).replace(/"/g, '\\"');
}

function closeFile(file) {
  try {
    if (file) file.doClose();
  } catch (e) {}
}

// Entry point khi chạy trực tiếp bằng Node.js.
if (typeof module !== 'undefined' && require.main === module) {
  var completedCaseResult = runCompletedPaymentCaseTests();
  console.log(completedCaseResult.output);
  if (!completedCaseResult.success) process.exitCode = 1;
}
