var ACCOUNTING_INFORMATION_TABLE = 'esdHTKTaccountingInformation';
var PREPAYMENT_ENTRY_TABLE = 'esdHTKTprepaymentEntry';
var DEBIT_ACCOUNT_TYPE = '\u006e\u1ee3';
var AP_ENTRY_TYPE = 'AP';
var GL_ENTRY_TYPE = 'GL';
var CORE_ENTRY_TYPE = 'CORE';
var SUB_TYPE_PREPAYMENT = 'TAM_UNG';
var SUB_TYPE_STANDARD = 'THUE';
// trưởng thêm: mã dòng ghi Có AP tự sinh dùng cho kết quả chuyển tiền
var AUTO_PAYMENT_ENTRY_CODE = 'TU-BT-03';
var ACCOUNTING_STATUS = {
	CREATED: 'CREATED',
	// INITIAL: 'INITIAL',
	INITIAL: 'NEW',
	PROCESSING: 'PROCESSING',
	COMPLETED: 'COMPLETED',
	ERROR: 'ERROR',
	NOT_FOUND: 'NOT_FOUND'
};
var ACCOUNTING_STATUS_MAP = {
	CREATED: 'Đang xử lý',
	// INITIAL: 'Đang xử lý hạch toán',
	NEW: 'Đang xử lý',
	PROCESSING: 'Đang xử lý',
	COMPLETED: 'Thành Công',
	ERROR: 'Gửi Thất Bại',
	NOT_FOUND: 'Không tìm thấy giao dịch với transactionId'
};

function renderTabAccountingResults() {
	var currentRecord = vars['$L.file'];
	var prepaymentId = textValue(vars['$G.prepayment.id']).trim();

	if (!prepaymentId && currentRecord) {
		prepaymentId = textValue(currentRecord['id']).trim();
	}

	var result = loadAccountingResults(prepaymentId);

	return buildAccountingResultsHtml(result.rows, result.error);
}

function loadAccountingResults(prepaymentId) {
	var result = { rows: [], error: '' };
	var groupMap = {};
	var groups = [];
	var f;

	if (!prepaymentId) {
		result.error = 'Kh&#244;ng nh&#7853;n &#273;&#432;&#7907;c m&#227; &#273;&#7873; ngh&#7883; t&#7841;m &#7913;ng.';
		return result;
	}

	try {
		f = new SCFile(ACCOUNTING_INFORMATION_TABLE, SCFILE_READONLY);
		var query = 'prepayment.id="' + escapeQueryValue(prepaymentId) + '"';
		var rc = f.doSelect(query);

		while (rc === RC_SUCCESS) {
			addAccountingResultGroup(groupMap, groups, f);

			rc = f.getNext();
		}

		result.rows = buildGroupedResultRows(groups);
	} catch (e) {
		result.error = 'Kh&#244;ng th&#7875; t&#7843;i k&#7871;t qu&#7843; h&#7841;ch to&#225;n.';
	} finally {
		// closeFile(f);
		// trưởng thêm: gọi trực tiếp doClose để đóng SCFile
		try {
			if (f) f.doClose();
		} catch (eClose) {}
	}

	return result;
}

function addAccountingResultGroup(groupMap, groups, record) {
	var info = {
		requestId: textValue(record['request.id']),
		vendorId: textValue(record['vendor.id']),
		accountingType: textValue(record['type']),
		subType: textValue(record['sub.type']),
		amount: numberValue(record['amount']),
		batchName: textValue(record['batch.name']),
		invoiceNumber: textValue(record['ap.code']),
		status: textValue(record['status']),
		checkedTime: record['checked.time']
	};
	var entrySummary = getEntrySummary(info.requestId, info.vendorId, info.accountingType);
	info.glGroupOrder = entrySummary.glGroupOrder;
	var key = makeAccountingResultGroupKey(info);
	var group = groupMap[key];

	if (!group) {
		group = {
			key: key,
			accountingTypeCode: textValue(info.accountingType).trim().toUpperCase(),
			accountingType: mapAccountingTypeLabel(
					info.accountingType,
					info.subType
			),
			contentLines: [],
			amount: 0,
			currency: '',
			// trưởng thêm: tài khoản thụ hưởng lấy từ account.number của dòng ghi Có AP
			beneficiaryAccount: '',
			batchName: '',
			invoiceNumber: '',
			status: '',
			checkedTime: null
		};
		groupMap[key] = group;
		groups.push(group);
	}

	appendContentLines(group.contentLines, entrySummary.contentLines);
	// trưởng thêm: gộp STK thụ hưởng khi nhóm có nhiều kết quả CORE
	group.beneficiaryAccount = mergeTextValue(
			group.beneficiaryAccount,
			entrySummary.beneficiaryAccount
	);
	group.amount +=
			textValue(info.accountingType).trim().toUpperCase() === CORE_ENTRY_TYPE
					? info.amount
					: numberValue(entrySummary.debitAmount);

	if (!group.currency && entrySummary.currency) group.currency = entrySummary.currency;
	group.batchName = mergeTextValue(group.batchName, info.batchName);
	group.invoiceNumber = mergeTextValue(group.invoiceNumber, info.invoiceNumber);
	group.status = mergeStatus(group.status, info.status);
	group.checkedTime = getLatestDateValue(group.checkedTime, info.checkedTime);
}

function makeAccountingResultGroupKey(info) {
	var accountingType = textValue(info.accountingType).trim().toUpperCase();
	var glGroupOrder =
			accountingType === GL_ENTRY_TYPE
					? textValue(info.glGroupOrder).trim() || '1'
					: '';

	return [
		accountingType,
		textValue(info.vendorId).trim(),
		textValue(info.subType).trim(),
		glGroupOrder
	].join('|');
}

/**
 * map type và sub.type thành nhãn loại bút toán hiển thị trên giao diện.
 */
function mapAccountingTypeLabel(accountingType, subType) {
	var type = textValue(accountingType).trim().toUpperCase();
	var sub = textValue(subType).trim().toUpperCase();

	if (type !== AP_ENTRY_TYPE) return type;
	if (sub === SUB_TYPE_PREPAYMENT) return 'AP-Prepayment';
	if (sub === SUB_TYPE_STANDARD) return 'AP-Standard';

	return type;
}

function buildGroupedResultRows(groups) {
	var rows = [];

	for (var i = 0; i < groups.length; i++) {
		rows.push({
			index: i + 1,
			accountingTypeCode: groups[i].accountingTypeCode,
			accountingType: groups[i].accountingType,
			contentLines: groups[i].contentLines,
			amount: groups[i].amount,
			currency: groups[i].currency,
			beneficiaryAccount: groups[i].beneficiaryAccount,
			batchName: groups[i].batchName,
			invoiceNumber: groups[i].invoiceNumber,
			status: groups[i].status,
			checkedTime: groups[i].checkedTime
		});
	}

	return rows;
}

function appendContentLines(target, lines) {
	var values = lines || [];

	for (var i = 0; i < values.length; i++) {
		target.push(textValue(values[i]).trim());
	}
}

function mergeTextValue(currentValue, nextValue) {
	currentValue = textValue(currentValue).trim();
	nextValue = textValue(nextValue).trim();

	if (!nextValue) return currentValue;
	if (!currentValue) return nextValue;
	if (currentValue === nextValue) return currentValue;

	return currentValue + '; ' + nextValue;
}

function mergeStatus(currentStatus, nextStatus) {
	var currentCode = textValue(currentStatus).trim().toUpperCase();
	var nextCode = textValue(nextStatus).trim().toUpperCase();
	var currentFailed =
			currentCode === ACCOUNTING_STATUS.ERROR ||
			currentCode === ACCOUNTING_STATUS.NOT_FOUND;
	var nextFailed =
			nextCode === ACCOUNTING_STATUS.ERROR ||
			nextCode === ACCOUNTING_STATUS.NOT_FOUND;
	var currentProcessing =
			currentCode === ACCOUNTING_STATUS.PROCESSING ||
			currentCode === ACCOUNTING_STATUS.CREATED ||
			currentCode === ACCOUNTING_STATUS.INITIAL;
	var nextProcessing =
			nextCode === ACCOUNTING_STATUS.PROCESSING ||
			nextCode === ACCOUNTING_STATUS.CREATED ||
			nextCode === ACCOUNTING_STATUS.INITIAL;

	if (!currentCode) return nextCode;
	if (!nextCode) return currentCode;
	if (currentFailed) return currentCode;
	if (nextFailed) return nextCode;
	if (currentProcessing) return currentCode;
	if (nextProcessing) return nextCode;
	if (
			currentCode === ACCOUNTING_STATUS.COMPLETED &&
			nextCode === ACCOUNTING_STATUS.COMPLETED
	) {
		return ACCOUNTING_STATUS.COMPLETED;
	}

	return currentCode;
}

function getLatestDateValue(currentValue, nextValue) {
	if (!currentValue) return nextValue;
	if (!nextValue) return currentValue;

	return getDateSortValue(nextValue) > getDateSortValue(currentValue) ? nextValue : currentValue;
}

function getEntrySummary(requestId, vendorId, accountingType) {
	var summary = {
		contentLines: [],
		debitAmount: 0,
		currency: '',
		// trưởng thêm: STK của dòng ghi Có AP tự sinh
		beneficiaryAccount: '',
		glGroupOrder: ''
	};
	var f;

	if (!requestId) return summary;

	try {
		f = new SCFile(PREPAYMENT_ENTRY_TABLE, SCFILE_READONLY);
		var query = 'accounting.request.id="' + escapeQueryValue(requestId) + '"';
		var accountingTypeCode = textValue(accountingType).trim().toUpperCase();
		var entryType = getEntryTypeFilter(accountingType);

		// if (entryType) {
		//     query += ' and type="' + entryType + '"';
		// }
		// trưởng thêm: CORE chỉ lấy dòng ghi Có TU-BT-03 của bút toán AP tự sinh
		if (accountingTypeCode === CORE_ENTRY_TYPE) {
			query += ' and type="' + AP_ENTRY_TYPE + '"';
			query += ' and entry.type="' + AUTO_PAYMENT_ENTRY_CODE + '"';
		} else if (entryType) {
			query += ' and type="' + entryType + '"';
		}
		if (entryType !== GL_ENTRY_TYPE && vendorId) {
			query += ' and vendor.id="' + escapeQueryValue(vendorId) + '"';
		}
		var rc = f.doSelect(query);

		while (rc === RC_SUCCESS) {
			summary.contentLines.push(textValue(f['description']).trim());

			if (entryType === GL_ENTRY_TYPE && !summary.glGroupOrder) {
				summary.glGroupOrder = getGlEntryGroupOrder(
						textValue(f['prepayment.id']),
						textValue(f['id'])
				);
			}

			if (!summary.currency) {
				summary.currency = textValue(f['currency']);
			}

			// trưởng thêm: account.number của TU-BT-03 là tài khoản thụ hưởng
			if (
					accountingTypeCode === CORE_ENTRY_TYPE &&
					!summary.beneficiaryAccount
			) {
				summary.beneficiaryAccount = textValue(f['account.number']).trim();
			}

			if (isDebitAccountType(f['account.type'])) {
				summary.debitAmount += numberValue(f['amount']);
			}

			rc = f.getNext();
		}
	} finally {
		// closeFile(f);
		// trưởng thêm: gọi trực tiếp doClose để đóng SCFile
		try {
			if (f) f.doClose();
		} catch (eClose) {}
	}

	return summary;
}

/**
 * Đọc số bút toán từ ID GL <prepaymentId>.GL.<số bút toán>.<số dòng>.
 * ID GL cũ <prepaymentId>.GL.<số dòng> được xem là bút toán số 1.
 */
function getGlEntryGroupOrder(prepaymentId, entryId) {
	var prefix = textValue(prepaymentId).trim() + '.' + GL_ENTRY_TYPE + '.';
	var id = textValue(entryId).trim();

	if (!prepaymentId || id.indexOf(prefix) !== 0) return '';

	var parts = id.substring(prefix.length).split('.');

	if (
			parts.length === 2 &&
			/^\d+$/.test(parts[0]) &&
			/^\d+$/.test(parts[1]) &&
			Number(parts[0]) > 0 &&
			Number(parts[1]) > 0
	) {
		return String(Number(parts[0]));
	}

	if (
			parts.length === 1 &&
			/^\d+$/.test(parts[0]) &&
			Number(parts[0]) > 0
	) {
		return '1';
	}

	return '';
}

function getEntryTypeFilter(value) {
	var type = textValue(value).trim().toUpperCase();
	if (type === AP_ENTRY_TYPE) return AP_ENTRY_TYPE;
	if (type === GL_ENTRY_TYPE) return GL_ENTRY_TYPE;
	return '';
}

function isDebitAccountType(value) {
	var accountType = normalizeValue(value);
	return accountType === normalizeValue(DEBIT_ACCOUNT_TYPE) || accountType === 'debit';
}

function buildAccountingResultsHtml(rows, error) {
	var accountingRows = [];
	var transferRows = [];

	for (var i = 0; i < rows.length; i++) {
		if (
				textValue(rows[i].accountingTypeCode).trim().toUpperCase() ===
				CORE_ENTRY_TYPE
		) {
			transferRows.push(rows[i]);
		} else {
			accountingRows.push(rows[i]);
		}
	}

	return [
		'<!DOCTYPE html>',
		'<html lang="vi"><head><meta charset="UTF-8">',
		'<meta name="viewport" content="width=device-width,initial-scale=1.0">',
		'<style>',
		'html,body{margin:0;padding:0;background:#fff;font-family:Arial,sans-serif;color:#111827}',
		'*{box-sizing:border-box}',
		'.result{width:100%;padding:20px}',
		'.result-section+.result-section{margin-top:24px}',
		'.result-head{display:flex;align-items:center;gap:10px;margin-bottom:16px}',
		'.title{color:#173b7a;font-size:15px;font-weight:700}',
		'.counter{padding:6px 12px;border-radius:6px;background:#ebf0ff;color:#173b7a;font-size:13px;font-weight:700}',
		'.table-wrap{width:100%;overflow-x:auto;border:1px solid #d9e0eb;border-radius:8px}',
		'table{width:100%;min-width:1080px;border-collapse:collapse;table-layout:fixed;font-size:13px}',
		'th,td{padding:10px 12px;text-align:left;vertical-align:middle;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
		'th{height:44px;background:#dce8fb;font-weight:600}',
		'td{height:50px;border-top:1px solid #d9e0eb}',
		'th[data-column]{cursor:pointer;user-select:none}',
		'th[data-column]:hover{background:#cfdff8}',
		'th[data-column]:focus{outline:2px solid #2563eb;outline-offset:-2px}',
		'.sort{margin-left:7px;color:#64748b;font-size:14px;font-weight:400}',
		'.amount{font-variant-numeric:tabular-nums}',
		'.content{overflow:visible;white-space:normal}',
		'.content-line{display:block;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;line-height:1.45}',
		'.content-line+.content-line{margin-top:4px}',
		'.accounting-cell-tooltip{display:none;position:fixed;z-index:2147483647;max-width:360px;padding:7px 10px;border-radius:4px;background:#202124;color:#fff;font-size:13px;font-weight:400;line-height:1.4;white-space:normal;word-break:break-word;box-shadow:0 2px 8px rgba(0,0,0,.28);pointer-events:none}',
		'.accounting-cell-tooltip:after{content:"";position:absolute;left:50%;margin-left:-5px;border-style:solid;border-width:5px}',
		'.accounting-cell-tooltip[data-placement="top"]:after{top:100%;border-color:#202124 transparent transparent transparent}',
		'.accounting-cell-tooltip[data-placement="bottom"]:after{bottom:100%;border-color:transparent transparent #202124 transparent}',
		'.status{display:block;width:100%;padding:7px 12px;border-radius:8px;text-align:center;font-weight:600;white-space:nowrap}',
		'.status-success{background:#dff6e5;color:#166534}',
		'.status-failed{background:#fcebe8;color:#dc2626}',
		'.status-processing{background:#fef3c7;color:#d97706}',
		'.status-default{background:#eef2f7;color:#475569}',
		'.empty{text-align:center;color:#64748b}',
		'.c-index{width:5%}.c-type{width:11%}.c-content{width:15%}.c-amount{width:10%}.c-currency{width:8%}',
		'.c-batch{width:13%}.c-invoice{width:14%}.c-status{width:13%}.c-time{width:11%}',
		// trưởng thêm: độ rộng 7 cột của bảng kết quả chuyển tiền theo Figma
		'#transfer-results-table{min-width:900px}',
		// '.c-transfer-index{width:5%}.c-transfer-content{width:29%}.c-transfer-amount{width:12%}.c-transfer-currency{width:10%}',
		// '.c-beneficiary-account{width:20%}.c-transfer-status{width:14%}.c-transfer-time{width:10%}',
		// trưởng thêm: thu cột Nội dung hạch toán còn 2/3 và chuyển phần rộng còn lại sang Tài khoản thụ hưởng
		// '.c-transfer-index{width:5%}.c-transfer-content{width:19.33%}.c-transfer-amount{width:12%}.c-transfer-currency{width:10%}',
		// '.c-beneficiary-account{width:29.67%}.c-transfer-status{width:14%}.c-transfer-time{width:10%}',
		// trưởng thêm: giữ Nội dung hạch toán 19.33%, chia đều phần còn lại cho STK, trạng thái và thời gian
		'.c-transfer-index{width:5%}.c-transfer-content{width:19.33%}.c-transfer-amount{width:12%}.c-transfer-currency{width:10%}',
		'.c-beneficiary-account{width:20%}.c-transfer-status{width:18%}.c-transfer-time{width:15.67%}',
		'@media(max-width:768px){.result{padding:12px}.result-head{align-items:flex-start;flex-direction:column}}',
		'</style></head><body>',
		'<main class="result">',
		buildAccountingResultSection(
				'Kết quả hạch toán',
				'Số bút toán đồng bộ thành công',
				accountingRows,
				error,
				'accounting-results-table',
				false
		),
		// buildAccountingResultSection(
		//     'Kết quả chuyển tiền',
		//     'Số giao dịch đồng bộ thành công',
		//     transferRows,
		//     error,
		//     'transfer-results-table',
		//     true
		// ),
		// trưởng thêm: bảng chuyển tiền riêng theo đúng 7 cột trên Figma
		buildTransferResultSection(
				'Kết quả chuyển tiền',
				'Số giao dịch đồng bộ thành công',
				transferRows,
				error,
				'transfer-results-table'
		),
		'</main>',
		'<div id="accounting-cell-tooltip" class="accounting-cell-tooltip" role="tooltip" aria-hidden="true"></div>',
		buildSortingScript('accounting-results-table'),
		buildSortingScript('transfer-results-table'),
		buildAccountingTooltipScript(),
		'</body></html>'
	].join('');
}

function buildAccountingResultSection(
		title,
		counterLabel,
		rows,
		error,
		tableId,
		isTransferSection
) {
	var successCount = 0;
	var bodyRows = [];

	for (var i = 0; i < rows.length; i++) {
		var status = getStatusView(rows[i].status);
		var accountingTypeLabel = isTransferSection
				? 'Hạch toán tạm ứng - AP'
				: rows[i].accountingType;

		if (status.code === 'success') successCount++;
		bodyRows.push(
				buildAccountingResultRow(
						rows[i],
						status,
						i + 1,
						accountingTypeLabel
				)
		);
	}

	if (!bodyRows.length) {
		bodyRows.push(
				'<tr><td class="empty" colspan="9">' +
				(error || 'Kh&#244;ng c&#243; d&#7919; li&#7879;u') +
				'</td></tr>'
		);
	}

	return [
		'<section class="result-section">',
		'<div class="result-head">',
		'<span class="title">', htmlValue(title), '</span>',
		'<span class="counter">', htmlValue(counterLabel), ': ',
		successCount, '/', rows.length, '</span>',
		'</div>',
		'<div class="table-wrap"><table id="', attributeValue(tableId), '">',
		'<colgroup>',
		'<col class="c-index"><col class="c-type"><col class="c-content"><col class="c-amount"><col class="c-currency">',
		'<col class="c-batch"><col class="c-invoice"><col class="c-status"><col class="c-time">',
		'</colgroup>',
		'<thead><tr>',
		buildHeader('c-index', 'STT', 0, 'number'),
		buildHeader('c-type', 'Lo&#7841;i b&#250;t to&#225;n', 1, 'text'),
		buildHeader('c-content', 'N&#7897;i dung h&#7841;ch to&#225;n', 2, 'text'),
		buildHeader('c-amount', 'S&#7889; ti&#7873;n', 3, 'number'),
		buildHeader('c-currency', 'Lo&#7841;i ti&#7873;n', 4, 'text'),
		buildHeader('c-batch', 'Batch name (OGL)', 5, 'text'),
		buildHeader('c-invoice', 'S&#7889; Invoice (OGL)', 6, 'text'),
		buildHeader('c-status', 'Tr&#7841;ng th&#225;i x&#7917; l&#253; OGL', 7, 'text'),
		buildHeader('c-time', 'Th&#7901;i gian c&#7853;p nh&#7853;t', 8, 'number'),
		'</tr></thead><tbody>',
		bodyRows.join(''),
		'</tbody></table></div>',
		'</section>'
	].join('');
}

// trưởng thêm: giao diện riêng cho kết quả chuyển tiền theo Figma
function buildTransferResultSection(title, counterLabel, rows, error, tableId) {
	var successCount = 0;
	var bodyRows = [];

	for (var i = 0; i < rows.length; i++) {
		var status = getStatusView(rows[i].status);

		if (status.code === 'success') successCount++;
		bodyRows.push(buildTransferResultRow(rows[i], status, i + 1));
	}

	if (!bodyRows.length) {
		bodyRows.push(
				'<tr><td class="empty" colspan="7">' +
				(error || 'Kh&#244;ng c&#243; d&#7919; li&#7879;u') +
				'</td></tr>'
		);
	}

	return [
		'<section class="result-section">',
		'<div class="result-head">',
		'<span class="title">', htmlValue(title), '</span>',
		'<span class="counter">', htmlValue(counterLabel), ': ',
		successCount, '/', rows.length, '</span>',
		'</div>',
		'<div class="table-wrap"><table id="', attributeValue(tableId), '">',
		'<colgroup>',
		'<col class="c-transfer-index"><col class="c-transfer-content"><col class="c-transfer-amount">',
		'<col class="c-transfer-currency"><col class="c-beneficiary-account">',
		'<col class="c-transfer-status"><col class="c-transfer-time">',
		'</colgroup>',
		'<thead><tr>',
		buildHeader('c-transfer-index', 'STT', 0, 'number'),
		buildHeader('c-transfer-content', 'N&#7897;i dung h&#7841;ch to&#225;n', 1, 'text'),
		buildHeader('c-transfer-amount', 'S&#7889; ti&#7873;n', 2, 'number'),
		buildHeader('c-transfer-currency', 'Lo&#7841;i ti&#7873;n', 3, 'text'),
		buildHeader('c-beneficiary-account', 'T&#224;i kho&#7843;n th&#7909; h&#432;&#7903;ng', 4, 'text'),
		buildHeader('c-transfer-status', 'Tr&#7841;ng th&#225;i x&#7917; l&#253;', 5, 'text'),
		buildHeader('c-transfer-time', 'Th&#7901;i gian c&#7853;p nh&#7853;t', 6, 'number'),
		'</tr></thead><tbody>',
		bodyRows.join(''),
		'</tbody></table></div>',
		'</section>'
	].join('');
}

function buildHeader(className, label, columnIndex, sortType) {
	return '<th class="' + className + '" data-column="' + columnIndex + '" data-sort-type="' + sortType +
			'" tabindex="0" role="button" aria-sort="none">' + label + '<span class="sort">&#8597;</span></th>';
}

function buildAccountingResultRow(row, status, displayIndex, accountingTypeLabel) {
	var contentSortValue = (row.contentLines || []).join(' ');
	var content = buildAccountingContent(row.contentLines);
	var rowIndex = Number(displayIndex) || 1;
	var typeLabel = textValue(accountingTypeLabel).trim();
	var amountLabel = formatAmount(row.amount);
	var checkedTimeLabel = formatCheckedTime(row.checkedTime);

	return [
		'<tr data-result-row="true" data-original-index="', rowIndex, '">',
		'<td class="accounting-tooltip-target" data-sort="', rowIndex, '"', buildTooltipAttributes(rowIndex), '>', rowIndex, '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(typeLabel), '"', buildTooltipAttributes(typeLabel), '>', htmlValue(typeLabel), '</td>',
		'<td class="content" data-sort="', attributeValue(contentSortValue), '">', content, '</td>',
		'<td class="amount accounting-tooltip-target" data-sort="', numberValue(row.amount), '"', buildTooltipAttributes(amountLabel), '>', amountLabel, '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(row.currency), '"', buildTooltipAttributes(row.currency), '>', htmlValue(row.currency), '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(row.batchName), '"', buildTooltipAttributes(row.batchName), '>', htmlValue(row.batchName), '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(row.invoiceNumber), '"', buildTooltipAttributes(row.invoiceNumber), '>', htmlValue(row.invoiceNumber), '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(row.status), '"', buildTooltipAttributes(status.tooltip), '><span class="status status-', status.code, '">', status.label, '</span></td>',
		'<td class="accounting-tooltip-target" data-sort="', getDateSortValue(row.checkedTime), '"', buildTooltipAttributes(checkedTimeLabel), '>', htmlValue(checkedTimeLabel), '</td>',
		'</tr>'
	].join('');
}

// trưởng thêm: dòng kết quả chuyển tiền lấy nội dung và STK từ dòng ghi Có AP TU-BT-03
function buildTransferResultRow(row, status, displayIndex) {
	var contentSortValue = (row.contentLines || []).join(' ');
	var content = buildAccountingContent(row.contentLines);
	var rowIndex = Number(displayIndex) || 1;
	var amountLabel = formatAmount(row.amount);
	var checkedTimeLabel = formatCheckedTime(row.checkedTime);

	return [
		'<tr data-result-row="true" data-original-index="', rowIndex, '">',
		'<td class="accounting-tooltip-target" data-sort="', rowIndex, '"', buildTooltipAttributes(rowIndex), '>', rowIndex, '</td>',
		'<td class="content" data-sort="', attributeValue(contentSortValue), '">', content, '</td>',
		'<td class="amount accounting-tooltip-target" data-sort="', numberValue(row.amount), '"', buildTooltipAttributes(amountLabel), '>', amountLabel, '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(row.currency), '"', buildTooltipAttributes(row.currency), '>', htmlValue(row.currency), '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(row.beneficiaryAccount), '"', buildTooltipAttributes(row.beneficiaryAccount), '>', htmlValue(row.beneficiaryAccount), '</td>',
		'<td class="accounting-tooltip-target" data-sort="', attributeValue(row.status), '"', buildTooltipAttributes(status.tooltip), '><span class="status status-', status.code, '">', status.label, '</span></td>',
		'<td class="accounting-tooltip-target" data-sort="', getDateSortValue(row.checkedTime), '"', buildTooltipAttributes(checkedTimeLabel), '>', htmlValue(checkedTimeLabel), '</td>',
		'</tr>'
	].join('');
}

function buildAccountingContent(contentLines) {
	var lines = contentLines || [];
	var html = [];

	if (!lines.length) {
		return '<div class="content-line accounting-tooltip-target"' + buildTooltipAttributes('-') + '>-</div>';
	}

	for (var i = 0; i < lines.length; i++) {
		var content = textValue(lines[i]).trim();

		html.push(
				'<div class="content-line accounting-tooltip-target"' +
				buildTooltipAttributes(content) +
				'>' +
				htmlValue(content) +
				'</div>'
		);
	}

	return html.join('');
}

function buildTooltipAttributes(value) {
	var tooltip = textValue(value).trim() || '-';

	return ' data-tooltip="' + attributeValue(tooltip) +
			'" aria-label="' + attributeValue(tooltip) + '"';
}

function buildAccountingTooltipScript() {
	return [
		'<script>(function(){',
		'var tooltip=document.getElementById("accounting-cell-tooltip");if(!tooltip)return;',
		'var targets=document.querySelectorAll(".accounting-tooltip-target");',
		'function positionTooltip(target){',
		'var rect=target.getBoundingClientRect();var gap=8;',
		'var left=rect.left+(rect.width-tooltip.offsetWidth)/2;',
		'left=Math.max(gap,Math.min(left,window.innerWidth-tooltip.offsetWidth-gap));',
		'var top=rect.top-tooltip.offsetHeight-gap;var placement="top";',
		'if(top<gap){top=rect.bottom+gap;placement="bottom";}',
		'tooltip.style.left=Math.round(left)+"px";tooltip.style.top=Math.round(top)+"px";',
		'tooltip.setAttribute("data-placement",placement);',
		'}',
		'function showTooltip(){',
		'var content=this.getAttribute("data-tooltip")||"";if(!content)return;',
		'tooltip.textContent=content;tooltip.style.display="block";tooltip.setAttribute("aria-hidden","false");',
		'positionTooltip(this);',
		'}',
		'function hideTooltip(){tooltip.style.display="none";tooltip.setAttribute("aria-hidden","true");}',
		'for(var i=0;i<targets.length;i++){',
		'targets[i].onmouseenter=showTooltip;targets[i].onmouseleave=hideTooltip;',
		'targets[i].onfocus=showTooltip;targets[i].onblur=hideTooltip;',
		'}',
		'if(window.addEventListener){window.addEventListener("scroll",hideTooltip,true);window.addEventListener("resize",hideTooltip);}',
		'})();</script>'
	].join('');
}

function buildSortingScript(tableId) {
	return [
		'<script>(function(){',
		'var table=document.getElementById("', attributeValue(tableId), '");if(!table||!table.tBodies.length)return;',
		'var headers=table.querySelectorAll("th[data-column]");var body=table.tBodies[0];',
		'function sortTable(header){',
		'var column=Number(header.getAttribute("data-column"));var type=header.getAttribute("data-sort-type");',
		'var direction=header.getAttribute("data-direction")==="asc"?"desc":"asc";',
		'var rows=Array.prototype.slice.call(body.querySelectorAll("tr[data-result-row]"));',
		'for(var i=0;i<headers.length;i++){headers[i].removeAttribute("data-direction");headers[i].setAttribute("aria-sort","none");headers[i].querySelector(".sort").innerHTML="&#8597;";}',
		'header.setAttribute("data-direction",direction);header.setAttribute("aria-sort",direction==="asc"?"ascending":"descending");',
		'header.querySelector(".sort").innerHTML=direction==="asc"?"&#8593;":"&#8595;";',
		'rows.sort(function(a,b){',
		'var left=a.cells[column].getAttribute("data-sort")||"";var right=b.cells[column].getAttribute("data-sort")||"";',
		'var compared=0;if(type==="number"){left=Number(left)||0;right=Number(right)||0;compared=left-right;}',
		'else{left=left.toLocaleLowerCase();right=right.toLocaleLowerCase();compared=left<right?-1:left>right?1:0;}',
		'if(!compared)compared=Number(a.getAttribute("data-original-index"))-Number(b.getAttribute("data-original-index"));',
		'return direction==="asc"?compared:-compared;',
		'});',
		'for(var j=0;j<rows.length;j++)body.appendChild(rows[j]);',
		'}',
		'for(var k=0;k<headers.length;k++){headers[k].onclick=function(){sortTable(this);};headers[k].onkeydown=function(event){event=event||window.event;if(event.keyCode===13||event.keyCode===32){if(event.preventDefault)event.preventDefault();sortTable(this);}};}',
		'})();</script>'
	].join('');
}

function getStatusView(value) {
	var status = textValue(value).trim().toUpperCase();
	var label =
			ACCOUNTING_STATUS_MAP[status] ||
			status;

	// if (
	//     status === ACCOUNTING_STATUS.CREATED ||
	//     status === ACCOUNTING_STATUS.PROCESSING
	// ) {
	// trưởng thêm: INITIAL dùng cùng màu vàng/cam với trạng thái đang xử lý
	// if (
	//     status === ACCOUNTING_STATUS.INITIAL ||
	//     status === ACCOUNTING_STATUS.CREATED ||
	//     status === ACCOUNTING_STATUS.PROCESSING
	// ) {
	// trưởng thêm: NEW dùng cùng màu vàng/cam với nhóm trạng thái đang xử lý
	if (
			// status === ACCOUNTING_STATUS.NEW ||
			status === ACCOUNTING_STATUS.INITIAL ||
			status === ACCOUNTING_STATUS.CREATED ||
			status === ACCOUNTING_STATUS.PROCESSING
	) {
		return { code: 'processing', label: htmlValue(label), tooltip: label };
	}
	if (status === ACCOUNTING_STATUS.COMPLETED) {
		return { code: 'success', label: htmlValue(label), tooltip: label };
	}
	if (
			status === ACCOUNTING_STATUS.ERROR ||
			status === ACCOUNTING_STATUS.NOT_FOUND
	) {
		return { code: 'failed', label: htmlValue(label), tooltip: label };
	}

	return { code: 'default', label: htmlValue(label), tooltip: label };
}

function formatAmount(value) {
	var number = numberValue(value);
	var parts = String(number).split('.');
	var integerPart = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
	return parts.length > 1 ? integerPart + ',' + parts[1] : integerPart;
}

function formatCheckedTime(value) {
	if (!value) return '';

	if (typeof value.getFullYear === 'function') {
		return padNumber(value.getHours()) + ':' + padNumber(value.getMinutes()) + ' ' +
				padNumber(value.getDate()) + '/' + padNumber(value.getMonth() + 1) + '/' + value.getFullYear();
	}

	return textValue(value);
}

function getDateSortValue(value) {
	if (!value) return 0;
	if (typeof value.getTime === 'function') return value.getTime();

	var timestamp = Date.parse(textValue(value));
	return isNaN(timestamp) ? 0 : timestamp;
}

function padNumber(value) {
	return value < 10 ? '0' + value : String(value);
}

function htmlValue(value) {
	var text = textValue(value);
	if (!text) return '-';

	return escapeHtml(text);
}

function attributeValue(value) {
	return escapeHtml(textValue(value));
}

function escapeHtml(value) {
	return textValue(value)
			.replace(/&/g, '&amp;')
			.replace(/</g, '&lt;')
			.replace(/>/g, '&gt;')
			.replace(/"/g, '&quot;')
			.replace(/'/g, '&#39;');
}

function escapeQueryValue(value) {
	return textValue(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function normalizeValue(value) {
	return textValue(value).trim().toLowerCase();
}

function numberValue(value) {
	var number = Number(value);
	return isNaN(number) ? 0 : number;
}

function textValue(value) {
	return value === null || value === undefined ? '' : String(value);
}

function closeFile(file) {
	try {
		if (file) file.doClose();
	} catch (e) {}
}
