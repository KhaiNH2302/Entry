/** Tự động sinh và đồng bộ bút toán thanh toán trong esdHTKTpaymentEntry. */

/*
 * ===========================================================================
 *  TODO CÒN LẠI
 * ---------------------------------------------------------------------------
 *  TODO-CASE:
 *    - TT-17: chờ dữ liệu khoản phải trả của YCTT trước.
 *
 *  TODO-INTEGRATION:
 *    - Fill payload Invoice/AP, Apply Prepayment, Payment, GL và Core Banking.
 *    - Hiện tại chưa gọi hoặc gửi dữ liệu sang hệ thống tích hợp.
 *
 *  TODO-SUSPENDED:
 *    - Chưa có bảng/trường DB cho khoản treo nên chưa sinh TT-BK-07.
 *
 *  GIẢ THIẾT CẦN CHỐT:
 *    - Tài khoản quỹ tiền mặt chưa có trường DB riêng; tạm dùng credit.account.
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
    } else if (action === 'getListGlAccount') {
      result = getListGlAccount();
    } else {
      result = { success: false, error: 'Invalid action: ' + action };
    }

    input.queryReturn = JSON.stringify(result);
  } catch (e) {
    if (vars['$L.file']) {
      vars['$L.file'].queryReturn = JSON.stringify({
        success: false,
        error: 'Gateway Error: ' + e.toString()
      });
    }
  }
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
  COST: 'COST',             // TK chi phí
  PREPAYMENT: 'PREPAYMENT', // TK tạm ứng
  TAX: 'TAX',               // TK thuế
  PAYABLE: 'PAYABLE',       // TK phải trả
  CUSTOMER: 'CUSTOMER'      // TK KH
};

var GENERATION_PHASE = {
  DMMS: 'initial_dmms',
  KTTC: 'initial_kttc'
};

var CATEGORY_TAX_ACCOUNT_NUMBER = 'htkt_loai_khau_tru';
var CATEGORY_TAX_DEDUCTION_TYPE = 'dmhd_loai_khau_tru';
var DEDUCTION_TYPE_FULL = 'KHAUTRU_001';
var DEDUCTION_TYPE_RATE = 'KHAUTRU_002';
var DEDUCTION_TYPE_NONE = 'KHAUTRU_003';
var GL_UNIT_TRANSACTION_CODE = '98';

// =============================================================================
// SECTION 02 - LOAD / SYNC: đọc, sinh lại, merge, validate và lưu tự động
// =============================================================================

/** Lấy bút toán đã lưu hoặc sinh mới khi chưa có dữ liệu. */
function getListPaymentEntryByInputDetails(details) {
  var paymentId = safeString(details.paymentId).trim();

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
  var initialRole = request.initial_role;
  var createdBy = request.created_by;
  var creatorUnit = getCreatorAccountingUnit(createdBy);
  var glUnitOptions = getGlUnitOptions();
  var transactionOfficeOptions = getTransactionOfficeOptions(creatorUnit.lv1Id);
  var defaultTransactionOfficeCode = getDefaultTransactionOfficeCode(transactionOfficeOptions);
  var savedEntries = getSavedPaymentEntries(paymentId);

  // Entry đã có thì trả ngay; dữ liệu nguồn được kiểm tra khi trigger gọi sinh lại.
  if (savedEntries.length > 0) {
    applyCreatorUnitToEntries(
      savedEntries,
      creatorUnit.code,
      defaultTransactionOfficeCode,
      transactionOfficeOptions
    );
    return makeResult(savedEntries, 'saved', {
      currentPhase: currentPhase,
      userCheckerKttc: userCheckerKttc,
      initialRole: initialRole,
      createdBy: createdBy,
      additionalUnitCode: creatorUnit.code,
      additionalUnitName: creatorUnit.name,
      glUnitOptions: glUnitOptions,
      transactionOfficeOptions: transactionOfficeOptions,
      defaultTransactionOfficeCode: defaultTransactionOfficeCode
    });
  }

  if (isGenerationPhaseLocked(currentPhase)) {
    return makeResult([], 'empty', {
      locked: true,
      currentPhase: currentPhase,
      userCheckerKttc: userCheckerKttc,
      initialRole: initialRole,
      createdBy: createdBy,
      additionalUnitCode: creatorUnit.code,
      additionalUnitName: creatorUnit.name,
      glUnitOptions: glUnitOptions,
      transactionOfficeOptions: transactionOfficeOptions,
      defaultTransactionOfficeCode: defaultTransactionOfficeCode
    });
  }

  // Nếu DB chưa có bút toán -> Tiến hành đồng bộ và sinh mới.
  var generatedResult = syncPaymentEntryNowByInputDetails(details);
  generatedResult.currentPhase = currentPhase;
  generatedResult.userCheckerKttc = userCheckerKttc;
  generatedResult.initialRole = initialRole;
  generatedResult.createdBy = createdBy;
  generatedResult.additionalUnitCode = creatorUnit.code;
  generatedResult.additionalUnitName = creatorUnit.name;
  generatedResult.glUnitOptions = glUnitOptions;
  generatedResult.transactionOfficeOptions = transactionOfficeOptions;
  generatedResult.defaultTransactionOfficeCode = defaultTransactionOfficeCode;
  return generatedResult;
}

/** Tính lại dữ liệu nguồn, giữ trường được sửa và đồng bộ entry khi chưa khóa. */
function syncPaymentEntryNowByInputDetails(details) {
  var paymentId = safeString(details.paymentId).trim();
  var vendorId = safeString(details.vendorId).trim();

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

  // Nếu dữ liệu thiếu/không đủ điều kiện tự động sinh bút toán -> Giữ nguyên CSDL
  if (!canGenerate) {
    return makeResult(savedEntries, savedEntries.length > 0 ? 'saved' : 'empty', makeGenerationErrorMeta(generationErrors));
  }

  if (isGenerationPhaseLocked(expectedResult.currentPhase)) {
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

  return makeResult(getSavedPaymentEntries(paymentId), 'synced', { sync: syncResult });
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

  var creatorUnit = getCreatorAccountingUnit(request.created_by);
  var transactionOfficeOptions = getTransactionOfficeOptions(creatorUnit.lv1Id);
  var defaultTransactionOfficeCode = getDefaultTransactionOfficeCode(transactionOfficeOptions);
  applyCreatorUnitToEntries(
    normalized.entries,
    creatorUnit.code,
    defaultTransactionOfficeCode,
    transactionOfficeOptions
  );
  var transactionOfficeValidation = validateTransactionOfficeRows(
    normalized.entries,
    transactionOfficeOptions
  );
  if (!transactionOfficeValidation.success) return transactionOfficeValidation;

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

  return makeResult(getSavedPaymentEntries(paymentId), 'saved', {
    paymentId: paymentId,
    deleted: deleted,
    inserted: inserted
  });
}

function validateAccountingBalanceRows(rows) {
  if (!rows || rows.length === 0) {
    return makeError('Thông tin hạch toán là bắt buộc.');
  }

  var totalDebit = 0;
  var totalCredit = 0;
  var glGroups = {};

  for (var i = 0; i < rows.length; i++) {
    var accountSide = getAccountingSide(rows[i].account_type);
    var amount = toNumber(rows[i].amount);

    if (!accountSide) {
      return makeError('Bút toán dòng ' + (i + 1) + ' chưa xác định Ghi nợ/Ghi có.');
    }

    if (accountSide === 'debit') totalDebit += amount;
    if (accountSide === 'credit') totalCredit += amount;

    if (isAdditionalEntryType(rows[i].type)) {
      var glIdParts = getGlEntryIdParts(rows[i].payment_id, rows[i].id);
      if (!glIdParts) {
        return makeError('Bút toán GL dòng ' + (i + 1) + ' có ID không đúng cấu trúc mới.');
      }
      var groupOrder = glIdParts.groupOrder;
      var groupKey = safeString(groupOrder);
      if (!glGroups[groupKey]) {
        glGroups[groupKey] = {
          groupOrder: groupOrder,
          totalDebit: 0,
          totalCredit: 0
        };
      }
      if (accountSide === 'debit') glGroups[groupKey].totalDebit += amount;
      if (accountSide === 'credit') glGroups[groupKey].totalCredit += amount;
    }
  }

  for (var glGroupKey in glGroups) {
    if (!glGroups.hasOwnProperty(glGroupKey)) continue;
    var glGroup = glGroups[glGroupKey];
    if (Math.abs(glGroup.totalDebit - glGroup.totalCredit) > MONEY_EPSILON) {
      return makeError(
        'Bút toán GL ' + glGroup.groupOrder + ': tổng ghi nợ phải bằng tổng ghi có.'
      );
    }
  }

  // Validate tổng ghi nợ bằng tổng ghi có khi lưu chỉnh sửa bút toán.
  if (Math.abs(totalDebit - totalCredit) > MONEY_EPSILON) {
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
  var apGroups = {};
  var apKeys = [];
  var glGroups = {};
  var glKeys = [];
  var list = rows || [];

  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var isGl = isAdditionalEntryType(row.type);
    var idParts = isGl ? getGlEntryIdParts(row.payment_id, row.id) : null;
    var key = isGl
      ? safeString(idParts ? idParts.groupOrder : 1)
      : safeString(row.vendor_id).trim() + '|' +
        safeString(row.vendor_site_id).trim() + '|' +
        safeString(row.vendor_site_code).trim();
    var groups = isGl ? glGroups : apGroups;
    var keys = isGl ? glKeys : apKeys;

    if (!groups[key]) {
      groups[key] = { items: [], totalDebt: 0, totalCr: 0 };
      keys.push(key);
    }

    var side = getAccountingSide(row.account_type);
    var amount = toNumber(row.amount);
    var debtAmount = side === 'debit' ? amount : 0;
    var crAmount = side === 'credit' ? amount : 0;
    groups[key].items.push({
      stt: isGl && idParts ? idParts.rowOrder : toNumber(row.order),
      accountNumner: safeString(row.account_number).trim(),
      accountName: safeString(row.account_name).trim(),
      bankName: '',
      description: safeString(row.description).trim(),
      debtAmount: debtAmount,
      crAmount: crAmount
    });
    groups[key].totalDebt += debtAmount;
    groups[key].totalCr += crAmount;
  }

  var result = [];
  for (var apIndex = 0; apIndex < apKeys.length; apIndex++) {
    result.push(apGroups[apKeys[apIndex]]);
  }
  for (var glIndex = 0; glIndex < glKeys.length; glIndex++) {
    result.push(glGroups[glKeys[glIndex]]);
  }
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
  var nextApSequence = getNextEntryIdSequence(paymentId, TYPE.AP, savedEntries);
  var nextGlRowSequence = getNextGlRowSequence(paymentId, 1, savedEntries);

  for (var i = 0; i < entries.length; i++) {
    var row = normalizeEditedEntry(entries[i]);

    if (!savedIds[row.id]) {
      if (isAdditionalEntryType(row.type)) {
        if (!isStructuredGlEntryId(paymentId, row.id)) {
          row.id = makeGlEntryId(paymentId, 1, nextGlRowSequence++);
        }
      } else {
        row.id = makeSequentialEntryId(paymentId, TYPE.AP, nextApSequence++);
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
  var selectedGlBranchCode =
    isGlEntry && selectedGlEntityCode
      ? getGlBranchCodeByEntityCode(selectedGlEntityCode)
      : safeString(raw.branch).trim();

  return {
    id: safeString(raw.id).trim(),
    payment_id: safeString(raw.payment_id).trim(),
    entry_type: normalizeEntryType(raw.entry_type),
    ledger_type: LEDGER_TYPE.STANDARD,
    account_type: toStoredAccountType(raw.account_type),
    account_number: safeString(raw.account_number).trim(),
    account_name: safeString(raw.account_name).trim(),
    branch: selectedGlBranchCode,
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
  if (
    entryCode === AUTO_ENTRY_CODE.LIABILITY ||
    entryCode === AUTO_ENTRY_CODE.REFUND_DR ||
    entryCode === AUTO_ENTRY_CODE.PAYMENT ||
    entryCode === AUTO_ENTRY_CODE.SUSPENDED
  ) {
    return ENTRY_TYPE.PAYABLE;
  }
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
 * 6) Khoản treo:       TT-BK-07                                   [TODO-SUSPENDED]
 * 7) Chuyển tiền:      TT-BK-08 = TT-BK-06 + TT-BK-07
 */
/**
 * Sinh bút toán theo 17 case thanh toán.
 * Các case chưa đủ quy tắc được giữ bằng hàm rỗng để bổ sung sau.
 */
function buildExpectedPaymentEntries(paymentId, vendorId) {
  var request = getPaymentRequest(paymentId);
  var creatorUnit = getCreatorAccountingUnit(request.created_by);
  request.creator_unit_code = creatorUnit.code;
  request.default_transaction_office_code = getDefaultTransactionOfficeCode(
    getTransactionOfficeOptions(creatorUnit.lv1Id)
  );
  var vendors = getPaymentVendors(paymentId, vendorId);
  var rows = [];
  var errors = [];
  var cases = [];
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
    var vendorErrors = getVendorAutoEntryErrors(vendor);
    if (vendorErrors.length > 0) {
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
      canGenerate = false;
      errors = errors.concat(context.errors);
      continue;
    }

    // Bước 2: chỉ phân case tại đây; không rải điều kiện case sang phần save.
    var caseCode = classifyPaymentCase(context);
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

    // Bước 3: gọi đúng handler TT-xx để tạo các dòng Nợ/Có.
    var vendorRows = buildEntriesByPaymentCase(caseCode, context);
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
    cases: cases,
    currentPhase: request.current_phase
  };
}

// -----------------------------------------------------------------------------
// SECTION 04A - DATA CASE: gom (1), (2), (3), thuế, loại NCC và Cost Division
// -----------------------------------------------------------------------------
function buildPaymentCaseContext(paymentId, request, vendor, vendorCount, firstOrder) {
  var taxInfo = getInvoiceTaxInfo(paymentId, vendor, vendorCount);
  var hasInvoice = hasLinkedInvoicesForVendor(paymentId, vendor, vendorCount);
  var costDivisions = hasInvoice ? getPaymentCostDivisions(paymentId, vendor.vendor_id) : [];
  var isPersonal = isPersonalPaymentVendor(vendor.vendor_type);
  // Cá nhân không dùng thuế GTGT tự động; thuế TNCN và số tiền do KT nhập.
  var errors = isPersonal ? [] : taxInfo.errors.slice(0);

  if (toNumber(vendor.approved_invoice_amount) > 0 && !hasInvoice) {
    errors.push('NCC ' + (vendor.vendor_id || '?') + ': có Giá trị hóa đơn chấp nhận nhưng chưa gắn hóa đơn.');
  }
  if (hasInvoice && costDivisions.length === 0 && !isPersonal) {
    errors.push('NCC ' + (vendor.vendor_id || '?') + ': có hóa đơn nhưng chưa có phân bổ chi phí tại ' + TABLE_COST_DIVISION + '.');
  }
  if (hasInvoice && costDivisions.length === 0 && isPersonal && !vendor.debit_account) {
    errors.push('NCC cá nhân ' + (vendor.vendor_id || '?') + ': không có PCCP và thiếu debit.account tại ' + TABLE_VENDOR_SITE + '.');
  }

  return {
    paymentId: paymentId,
    request: request,
    vendor: vendor,
    vendorCount: vendorCount,
    approvedAmount: toNumber(vendor.approved_invoice_amount), // (1)
    paymentAmount: toNumber(vendor.amount),                    // (2)
    refundAmount: toNumber(vendor.refund_amount),              // (3)
    hasInvoice: hasInvoice,
    hasTax: hasInvoice && taxInfo.hasDeductibleTax,
    isPersonal: isPersonal,
    taxInfo: taxInfo,
    costDivisions: costDivisions,
    firstOrder: firstOrder,
    errors: errors
  };
}

// -----------------------------------------------------------------------------
// SECTION 04B - PHÂN CASE: toàn bộ điều kiện TT-01 đến TT-17 nằm tại đây
// -----------------------------------------------------------------------------
/**
 * Phân case chỉ theo 3 số tiền, loại NCC và trạng thái thuế.
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

  // Vừa hoàn ứng vừa đi tiền: (1) = (2) + (3).
  if (moneyIsPositive(refund) && moneyIsPositive(payment) && moneyEquals(invoice, payment + refund)) {
    if (personal) return PAYMENT_CASE.TT10;
    if (!tax) return PAYMENT_CASE.TT08;
    return PAYMENT_CASE.TT09;
  }

  // Chỉ hoàn ứng một phần: (1) > (3), không đi tiền.
  if (moneyIsPositive(refund) && moneyIsZero(payment) && moneyGreaterThan(invoice, refund)) {
    if (personal) return PAYMENT_CASE.TT13;
    if (!tax) return PAYMENT_CASE.TT11;
    return PAYMENT_CASE.TT12;
  }

  // Hoàn ứng và đi tiền một phần: (1) > (2) + (3).
  if (moneyIsPositive(refund) && moneyIsPositive(payment) && moneyGreaterThan(invoice, payment + refund)) {
    if (personal) return PAYMENT_CASE.TT16;
    if (!tax) return PAYMENT_CASE.TT14;
    return PAYMENT_CASE.TT15;
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
    caseCode === PAYMENT_CASE.TT16;
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
function buildPaymentCaseTT11(c) { return buildStandardPaymentCase(c, true, false, true, false); }
function buildPaymentCaseTT12(c) { return buildStandardPaymentCase(c, true, true,  true, false); }
function buildPaymentCaseTT14(c) { return buildStandardPaymentCase(c, true, false, true, true); }
function buildPaymentCaseTT15(c) { return buildStandardPaymentCase(c, true, true,  true, true); }

// Case cá nhân: sinh tài khoản, để trống số tiền KT phải nhập.
function buildPaymentCaseTT02(c) { return buildPersonalPaymentCase(c, false, true); }
function buildPaymentCaseTT05(c) { return buildPersonalPaymentCase(c, false, true); }
function buildPaymentCaseTT10(c) { return buildPersonalPaymentCase(c, true,  true); }
function buildPaymentCaseTT13(c) { return buildPersonalPaymentCase(c, true,  false); }
function buildPaymentCaseTT16(c) { return buildPersonalPaymentCase(c, true,  true); }

// -----------------------------------------------------------------------------
// SECTION 05C - CASE CHỜ BỔ SUNG: giữ hàm rỗng để fill sau
// -----------------------------------------------------------------------------
// TT-17 chờ dữ liệu khoản phải trả của YCTT trước.
function buildPaymentCaseTT17(c) { return []; }

/**
 * Sinh paymentEntry cho NCC cá nhân.
 * - Có PCCP: mỗi account.number duy nhất sinh một dòng chi phí.
 * - Không PCCP: sinh một dòng chi phí từ vendorSite.debit.account.
 * - Chi phí, đi tiền và phải trả để amount=null cho KT nhập.
 * - refund.amount chỉ dùng phân case; không sinh Có TK tạm ứng tại đây.
 */
function buildPersonalPaymentCase(c, includeRefund, includePayment) {
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
      amount: null,
      allowBlankAmount: true,
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
  // refund.amount chỉ phân case, không giảm công nợ paymentEntry. Số hoàn ứng
  // thực tế sẽ được xử lý từ "Số tiền hoàn ứng lần này" tại tab Công nợ.
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
  var usedAccounts = {};

  for (var i = 0; i < c.costDivisions.length; i++) {
    var division = c.costDivisions[i];
    var accountNumber = safeString(division.account_number).trim();
    if (!accountNumber || usedAccounts[accountNumber]) continue;

    usedAccounts[accountNumber] = true;
    result.push({
      account_number: accountNumber,
      account_name: division.account_name || getGlAccountName(accountNumber),
      department: division.department,
      branch: division.branch
    });
  }

  if (result.length === 0) {
    result.push({
      account_number: c.vendor.debit_account,
      account_name: getGlAccountName(c.vendor.debit_account),
      department: c.request.department,
      branch: ''
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
function buildStandardPaymentCase(c, includeInvoice, includeTax, includeRefund, includePayment) {
  var rows = [];
  var order = c.firstOrder;
  var i;
  var payableCredit = includeInvoice ? c.approvedAmount : 0;
  var payableDebit = 0;

  if (includeInvoice) {
    for (i = 0; i < c.costDivisions.length; i++) {
      var division = c.costDivisions[i];
      rows.push(buildEntryRow({
        paymentId: c.paymentId,
        request: c.request,
        vendor: c.vendor,
        entryCode: AUTO_ENTRY_CODE.COST,
        amount: toNumber(division.amount_before_tax),
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

    // TODO-SUSPENDED: chưa có bảng/trường DB cho khoản treo.
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
        var costAmount = toNumber(cd.amount_before_tax);
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
     * TODO-SUSPENDED: cần bảng/trường DB lưu thông tin trả khoản treo.
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

  return {
    id: '',
    payment_id: params.paymentId,
    entry_type: getEntryTypeByRuleCode(params.entryCode),
    rule_code: params.entryCode,
    ledger_type: getAutoLedgerType(params.entryCode),
    account_type: getAutoAccountType(params.entryCode),
    account_number: account.number,
    account_name: account.name,
    branch: params.branchOverride || params.request.creator_unit_code || '',
    department: params.departmentOverride || params.request.department,
    transaction_office: params.transactionOfficeOverride ||
      params.request.default_transaction_office_code || '',
    amount: params.amount,
    currency: params.vendor.currency,
    description: params.request.description || '',
    vendor_id: params.vendor.vendor_id,
    type: TYPE.AP,
    order: params.order,
    accounting_request_id: '',
    payment_method: params.vendor.payment_method,
    // Chỉ dùng trong bước validate lúc khởi tạo case cá nhân; không lưu DB.
    allow_blank_amount: params.allowBlankAmount === true
  };
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
  if (entryCode === AUTO_ENTRY_CODE.TRANSFER && isBankTransfer(vendor.payment_method)) {
    return {
      number: vendor.beneficiary_account,
      name: vendor.beneficiary_name
    };
  }

  if (entryCode === AUTO_ENTRY_CODE.TRANSFER && isCashPayment(vendor.payment_method)) {
    // GIẢ THIẾT: chưa có trường DB riêng cho tài khoản quỹ tiền mặt.
    return {
      number: vendor.credit_account,
      name: 'Tài khoản tiền mặt'
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
    } else if (entryCode === AUTO_ENTRY_CODE.TRANSFER && isBankTransfer(row.payment_method)) {
      paymentVendorFields.push('beneficiary.account');
    } else if (entryCode === AUTO_ENTRY_CODE.TRANSFER && isCashPayment(row.payment_method)) {
      vendorSiteFields.push('credit.account');
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
  if (!vendor.vendor_site_code) vendorSiteFields.push('ogl.site.code');
  // Tài khoản phải trả NCC = credit.account.
  if (!vendor.credit_account) vendorSiteFields.push('credit.account');
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

  // Case hoàn ứng thuần có amount = 0; chỉ lỗi khi cả thanh toán và hoàn ứng đều bằng 0.
  if (toNumber(vendor.amount) <= 0 && toNumber(vendor.refund_amount) <= 0) {
    errors.push(subject + ': amount và refund.amount tại ' + TABLE_PAYMENT_VENDOR + ' không được đồng thời bằng 0.');
  }

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

    // Tiền thuế của một hóa đơn luôn lấy từ bảng hóa đơn gốc.
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

    // Gom total.tax theo loại khấu trừ để sinh đúng tài khoản TT-BK-02.
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
      amount_before_tax: readNumber(f, 'amount.before.tax'),
      amount_after_tax: readNumber(f, 'amount.after.tax'),
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

function getCreatorAccountingUnit(createdBy) {
  var creator = safeString(createdBy).trim();
  if (!creator) return { code: '', name: '', lv1Id: '' };

  var lv1Id = selectOne(
    TABLE_CONTACT,
    'contact.name="' + escapeQueryValue(creator) + '"',
    function (record) { return readText(record, 'lv1.id'); }
  );
  var psCode = removeFirstLeadingZero(lv1Id);
  if (!psCode) return { code: '', name: '', lv1Id: '' };

  return selectOne(
    TABLE_ENTITY,
    'ps.code="' + escapeQueryValue(psCode) + '"',
    function (record) {
      return {
        code: removeFirstLeadingZero(readText(record, 'ogl.branch.code')).trim(),
        name: getBranchNamePrefix(readText(record, 'branch.name')),
        lv1Id: lv1Id
      };
    }
  ) || { code: '', name: '', lv1Id: lv1Id };
}

function getGlUnitOptions() {
  var seen = {};
  var options = [];
  var f = new SCFile(TABLE_ENTITY, SCFILE_READONLY);
  var rc;
  try {
    rc = f.doSelect(
      'org.transaction.code="' + escapeQueryValue(GL_UNIT_TRANSACTION_CODE) + '"'
    );
  } catch (e) {
    closeFile(f);
    return options;
  }

  while (rc === RC_SUCCESS) {
    var entityCode = readText(f, 'entity.code').trim();
    if (entityCode && !seen[entityCode]) {
      seen[entityCode] = true;
      var branchName = getBranchNamePrefix(readText(f, 'branch.name'));
      options.push({
        label: entityCode + (branchName ? ' - ' + branchName : ''),
        value: entityCode,
        entityCode: entityCode,
        branchCode: normalizeGlBranchCode(readText(f, 'ogl.branch.code'))
      });
    }
    rc = f.getNext();
  }
  closeFile(f);
  options.sort(compareGlUnitOption);
  return options;
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

function compareGlUnitOption(left, right) {
  var a = safeString(left.entityCode);
  var b = safeString(right.entityCode);
  return a === b ? 0 : a < b ? -1 : 1;
}

function getTransactionOfficeOptions(lv1Id) {
  var rows = getLv2OrgUnitsByLv1(lv1Id);
  var seen = {};
  var options = [];
  for (var i = 0; i < rows.length; i++) {
    var lv2Id = safeString(rows[i]['unit.id']).trim();
    var lv2Name = safeString(rows[i]['unit.name']).trim();
    var entity = getTransactionOfficeByLv2(lv2Id);
    var code = safeString(entity.code).trim();
    if (!code || seen[code]) continue;
    seen[code] = true;
    options.push({
      value: code,
      label: code + ((lv2Name || entity.name) ? ' - ' + (lv2Name || entity.name) : ''),
      name: lv2Name || entity.name,
      unitId: lv2Id,
      psCode: removeFirstLeadingZero(lv2Id)
    });
  }
  options.sort(compareTransactionOfficeOption);
  return options;
}

function getLv2OrgUnitsByLv1(lv1Id) {
  var id = safeString(lv1Id).trim();
  if (!id) return [];
  return lib.ESD_Utils.fetchData(
    'esdQTorgUnit',
    'parent.id="' + escapeQueryValue(id) + '"',
    ['unit.id', 'unit.name']
  ) || [];
}

function getTransactionOfficeByLv2(lv2Id) {
  var psCode = removeFirstLeadingZero(lv2Id);
  if (!psCode) return { code: '', name: '' };
  var record = lib.ESD_Utils.getOneRecord(
    TABLE_ENTITY,
    'ps.code="' + escapeQueryValue(psCode) + '"',
    ['org.transaction.code', 'branch.name']
  );
  return record ? {
    code: safeString(record['org.transaction.code']).trim(),
    name: getBranchNamePrefix(record['branch.name'])
  } : { code: '', name: '' };
}

function compareTransactionOfficeOption(left, right) {
  var a = safeString(left.psCode) + '|' + safeString(left.value);
  var b = safeString(right.psCode) + '|' + safeString(right.value);
  return a === b ? 0 : a < b ? -1 : 1;
}

function getDefaultTransactionOfficeCode(options) {
  return options && options.length ? safeString(options[0].value).trim() : '';
}

function validateTransactionOfficeRows(entries, options) {
  if (!options || !options.length) return { success: true };
  var allowed = {};
  for (var i = 0; i < options.length; i++) {
    allowed[safeString(options[i].value).trim()] = true;
  }
  for (var j = 0; j < entries.length; j++) {
    var code = safeString(entries[j].transaction_office).trim();
    if (code && !allowed[code]) {
      return makeError('Phòng giao dịch dòng ' + (j + 1) + ' không thuộc đơn vị đã chọn.');
    }
  }
  return { success: true };
}

function isTransactionOfficeCodeAllowed(value, options) {
  var code = safeString(value).trim();
  if (!code) return false;
  if (!options || !options.length) return true;
  for (var i = 0; i < options.length; i++) {
    if (code === safeString(options[i].value).trim()) return true;
  }
  return false;
}

function applyCreatorUnitToEntries(entries, unitCode, defaultOffice, options) {
  for (var i = 0; i < entries.length; i++) {
    if (unitCode && !isAdditionalEntryType(entries[i].type)) {
      entries[i].branch = unitCode;
    }
    if (defaultOffice &&
        !isTransactionOfficeCodeAllowed(entries[i].transaction_office, options)) {
      entries[i].transaction_office = defaultOffice;
    }
  }
}

function removeFirstLeadingZero(value) {
  var text = safeString(value).trim();
  return text.charAt(0) === '0' ? text.substring(1) : text;
}

function getBranchNamePrefix(value) {
  var text = safeString(value).trim();
  var index = text.indexOf('-');
  return (index >= 0 ? text.substring(0, index) : text).trim();
}

function getPaymentVendors(paymentId, vendorId) {
  var list = [];
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

  return selectList(TABLE_PAYMENT_ENTRY, sql, fields);
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

  // Chi phí và thuế có thể có nhiều dòng nên phân biệt thêm theo tài khoản.
  if (entryType === ENTRY_TYPE.COST || entryType === ENTRY_TYPE.TAX) {
    key += '|' + safeString(row.account_number).trim();
  }

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
  return normalizeText(row.type) !== normalizeText(TYPE.GL);
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
  if (entryType === TYPE.GL) {
    return getNextGlRowSequence(paymentId, 1, rows);
  }
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
  if (entryType === TYPE.GL) {
    return makeGlEntryId(paymentId, 1, sequence);
  }
  return getEntryIdPrefix(paymentId, entryType) + sequence;
}

function getEntryIdPrefix(paymentId, entryType) {
  var prefix = safeString(paymentId).trim() + '.';
  return entryType === TYPE.GL ? prefix + TYPE.GL + '.' : prefix;
}

function makeGlEntryId(paymentId, groupOrder, rowOrder) {
  return getEntryIdPrefix(paymentId, TYPE.GL) + groupOrder + '.' + rowOrder;
}

function isStructuredGlEntryId(paymentId, entryId) {
  return !!getGlEntryIdParts(paymentId, entryId);
}

function getGlEntryIdParts(paymentId, entryId) {
  var prefix = getEntryIdPrefix(paymentId, TYPE.GL);
  var id = safeString(entryId).trim();
  if (id.indexOf(prefix) !== 0) return null;
  var parts = id.substring(prefix.length).split('.');

  if (parts.length === 2 &&
      /^\d+$/.test(parts[0]) && /^\d+$/.test(parts[1]) &&
      Number(parts[0]) > 0 && Number(parts[1]) > 0) {
    return {
      groupOrder: Number(parts[0]),
      rowOrder: Number(parts[1])
    };
  }
  return null;
}

function getNextGlRowSequence(paymentId, groupOrder, rows) {
  var maxSequence = 0;
  var list = rows || [];
  for (var i = 0; i < list.length; i++) {
    var parts = getGlEntryIdParts(paymentId, list[i].id);
    if (parts && parts.groupOrder === groupOrder && parts.rowOrder > maxSequence) {
      maxSequence = parts.rowOrder;
    }
  }
  return maxSequence + 1;
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
