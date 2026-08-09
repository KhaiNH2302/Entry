/**
 * Sinh esdHTKTaccountingInformation cho đề nghị thanh toán.
 * Mỗi bản ghi tương ứng một lần gọi API: AP invoice/payment, GL hoặc CORE.
 */

function run() {
	try {
		var input = vars['$L.file'];
		if (!input) return;
		var details = getInputDetails(input);
		var action = safeString(input.name).trim();
		var result;
		if (
				action === 'generateAccountingInformation' ||
				action === 'generatePaymentAccountingInformation'
		) {
			result = generatePaymentAccountingInformationByInputDetails(details);
		} else if (action === 'previewPaymentAccountingInformation') {
			var previewPaymentId = safeString(details.paymentId).trim() ||
					safeString(details.payment_id).trim() || safeString(details.id).trim();
			result = previewPaymentAccountingInformation(previewPaymentId);
		} else {
			result = { success: false, error: 'Invalid action: ' + action };
		}

		var output = JSON.stringify(result, null, 2);
		input.queryReturn = output;
		if (action === 'previewPaymentAccountingInformation') {
			try { print(output); } catch (ignorePrint) {}
		}
		return result;
	} catch (e) {
		if (vars['$L.file']) vars['$L.file'].queryReturn = JSON.stringify({
			success: false,
			error: 'Gateway Error: ' + e.toString()
		});
	}
}

var TABLE_AI = 'esdHTKTaccountingInformation';
var TABLE_PAYMENT = 'esdHTKTpayment';
var TABLE_VENDOR_ROW = 'esdHTKTpaymentVendor';
var TABLE_ENTRY = 'esdHTKTpaymentEntry';
var TABLE_PAYMENT_INVOICE = 'esdHTKTpaymentInvoice';
var TABLE_INVOICE = 'esdHTKTinvoice';
var TABLE_VENDOR = 'esdHTKTvendor';
var TABLE_VENDOR_SITE = 'esdHTKTvendorSite';
var TABLE_CONTACT = 'contacts';
var TABLE_ENTITY = 'esdDMentity';

var PHASE_END = 'end';
var STATUS_CREATED = 'CREATED';
var TYPE_AP = 'AP';
var TYPE_GL = 'GL';
var TYPE_CORE = 'CORE';
var SUB_PAYMENT = 'THANH_TOAN';
var SUB_TAX = 'THUE';
var SUB_INHOUSE = 'INHOUSE';
var SUB_CITAD = 'CITAD';
var CASH_YES = 'Y';
var CASH_NO = 'N';
var VIETINBANK_NAPAS = '970415';
var SEGMENT_1_DEFAULT = '0000000';
var SEGMENT_2_DEFAULT = '000000';
var SEGMENT_4_DEFAULT = '0000000';
var SEGMENT_5_DEFAULT = '0000000';
var SEGMENT_6_DEFAULT = '0000000';
var SEGMENT_7_DEFAULT = '0000000';

function generatePaymentAccountingInformationByInputDetails(details) {
	var paymentId = safeString(details.paymentId).trim() ||
			safeString(details.payment_id).trim() || safeString(details.id).trim();
	return generatePaymentAccountingInformation(paymentId, false);
}

/** Dựng dữ liệu để kiểm tra, tuyệt đối không ghi/xóa DB. */
function previewPaymentAccountingInformation(paymentId) {
	return generatePaymentAccountingInformation(paymentId, true);
}

function generatePaymentAccountingInformation(paymentId, previewOnly) {
	paymentId = safeString(paymentId).trim();
	if (!paymentId) return errorResult('Missing paymentId.');
	var payment = getPayment(paymentId);
	if (!payment.id) return errorResult('Khong tim thay de nghi thanh toan: ' + paymentId + '.');
	// if (safeString(payment.current_phase).trim() !== PHASE_END) return {
	// 	success: true, mode: 'skipped', paymentId: paymentId,
	// 	currentPhase: payment.current_phase,
	// 	message: 'Chi sinh accounting information khi current.phase = end.',
	// 	deleted: 0, inserted: 0, updatedEntries: 0, data: []
	// };

	var vendors = getPaymentVendors(paymentId);
	var entries = getPaymentEntries(paymentId);
	var prepared = [];
	var diagnostics = [];
	var warnings = [];
	if (!vendors.length) warnings.push('Khong co NCC tai esdHTKTpaymentVendor.');
	if (!entries.length) warnings.push('Khong co but toan tai esdHTKTpaymentEntry.');
	var accountingDate = dateYmd(new Date());
	for (var i = 0; i < vendors.length; i++) {
		vendors[i].payment_vendor_count = vendors.length;
		var contextResult = buildVendorContext(payment, vendors[i]);
		if (!contextResult.success) return contextResult;
		var vendorEntries = filterEntriesByVendor(entries, vendors[i].vendor_id);
		var payloadResults = buildVendorPayloads(payment, vendors[i], vendorEntries,
				contextResult.data, accountingDate);
		if (!payloadResults.success) return payloadResults;
		diagnostics.push({
			vendorId: vendors[i].vendor_id,
			approvedInvoiceAmount: vendors[i].approved_invoice_amount,
			paymentAmount: vendors[i].amount,
			entryCount: vendorEntries.length,
			payloadCount: payloadResults.data.length,
			entryTypes: summarizeEntryTypes(vendorEntries)
		});
		if (!vendorEntries.length) {
			warnings.push('NCC ' + vendors[i].vendor_id + ': khong co paymentEntry cung vendor.id.');
		} else if (!payloadResults.data.length) {
			warnings.push(
					'NCC ' + vendors[i].vendor_id +
					': co entry nhung khong co dong du dieu kien sinh AP/GL/CORE.'
			);
		}
		prepared = prepared.concat(payloadResults.data);
	}

	if (previewOnly) {
		var previewCreatedTime = system.functions.tod();
		var previewRows = [];
		for (var previewIndex = 0; previewIndex < prepared.length; previewIndex++) {
			previewRows.push(buildAccountingInformationRow(
					payment,
					prepared[previewIndex],
					previewCreatedTime
			));
		}
		return {
			success: true,
			mode: 'preview',
			readOnly: true,
			paymentId: paymentId,
			wouldInsert: previewRows.length,
			wouldUpdateEntries: countPreparedEntryIds(prepared),
			source: {
				vendorCount: vendors.length,
				entryCount: entries.length
			},
			diagnostics: diagnostics,
			warnings: uniqueText(warnings),
			data: previewRows
		};
	}

	var deleted = deleteAccountingInformation(paymentId);
	clearEntryRequestIds(paymentId);
	var createdTime = system.functions.tod();
	var inserted = 0;
	var updatedEntries = 0;
	var output = [];
	for (var p = 0; p < prepared.length; p++) {
		var item = prepared[p];
		var row = buildAccountingInformationRow(payment, item, createdTime);
		if (insertRecord(TABLE_AI, row) !== RC_SUCCESS) {
			deleteAccountingInformation(paymentId);
			clearEntryRequestIds(paymentId);
			return { success: false, paymentId: paymentId,
				error: 'Khong the tao accounting information requestId=' + item.requestId + '.',
				deleted: deleted, inserted: inserted, updatedEntries: updatedEntries };
		}
		inserted++;
		output.push(row);
		for (var e = 0; e < item.entryIds.length; e++) {
			if (updateEntryRequestId(item.entryIds[e], paymentId, item.requestId) === RC_SUCCESS) {
				updatedEntries++;
			}
		}
	}
	return { success: true, mode: 'generated', paymentId: paymentId,
		deleted: deleted, inserted: inserted, updatedEntries: updatedEntries,
		readyToSend: true, pendingFields: [], data: output };
}

function countPreparedEntryIds(prepared) {
	var ids = [];
	for (var i = 0; i < prepared.length; i++) {
		ids = ids.concat(prepared[i].entryIds || []);
	}
	return uniqueText(ids).length;
}

function summarizeEntryTypes(entries) {
	var result = [];
	for (var i = 0; i < entries.length; i++) {
		result.push(
			safeString(entries[i].type).trim().toUpperCase() + '/' +
			safeString(entries[i].entry_type).trim().toUpperCase() + '/' +
			safeString(entries[i].account_type).trim().toUpperCase()
		);
	}
	return uniqueText(result);
}

function buildVendorPayloads(payment, vendorRow, entries, context, accountingDate) {
	var result = [];
	var apLines = [];
	var apEntryIds = [];
	var applyList = [];
	var liabilityAccount = '';
	var glEntries = [];
	var coreEntries = [];
	var payablePayments = [];
	var customerPaymentAmount = 0;

	for (var i = 0; i < entries.length; i++) {
		var entry = entries[i];
		var type = safeString(entry.type).trim().toUpperCase();
		var entryType = safeString(entry.entry_type).trim().toUpperCase();
		var debit = isDebit(entry.account_type);
		if (type === TYPE_GL) {
			glEntries.push(entry);
			continue;
		}
		if (entryType === 'CUSTOMER' && isCredit(entry.account_type) &&
				isBankTransfer(vendorRow.payment_method)) {
			customerPaymentAmount += toNumber(entry.amount);
			coreEntries.push(entry);
			continue;
		}
		if (entryType === 'CUSTOMER' && isCredit(entry.account_type)) {
			customerPaymentAmount += toNumber(entry.amount);
			continue;
		}
		if (entryType === 'PAYABLE' && isCredit(entry.account_type)) {
			liabilityAccount = liabilityAccount || entry.account_number;
		}
		if (entryType === 'PREPAYMENT' && entry.ref_id && toNumber(entry.amount) > 0) {
			applyList.push({ invoiceNumber: entry.ref_id, amount: entry.amount });
			apEntryIds.push(entry.id);
		}
		if (entryType === 'PAYABLE' && debit && toNumber(vendorRow.approved_invoice_amount) <= 0) {
			payablePayments.push(entry);
			continue;
		}
		if (entryType === 'PAYABLE' && debit && toNumber(entry.amount) > 0) {
			if (!safeString(entry.ref_id).trim()) {
				return errorResult(
						'Entry ' + entry.id + ' tra khoan phai tra cu thieu ref.id.'
				);
			}
			applyList.push({ invoiceNumber: entry.ref_id, amount: entry.amount });
			apEntryIds.push(entry.id);
			continue;
		}
		if (debit && (entryType === 'COST' || entryType === 'TAX')) {
			apLines.push(mapInvoiceLine(entry, context.segment1));
			apEntryIds.push(entry.id);
		}
	}

	if (toNumber(vendorRow.approved_invoice_amount) > 0 && apLines.length) {
		var invoiceRequestId = uuid();
		var isPersonalVendor = normalizeIdentity(vendorRow.vendor_type) === 'canhan' ||
				normalizeIdentity(vendorRow.vendor_type) === 'cn';
		var invoiceAmount = isPersonalVendor
				? sumInvoiceLineAmounts(apLines)
				: vendorRow.approved_invoice_amount;
		var amountPay = isPersonalVendor
				? customerPaymentAmount
				: vendorRow.amount;
		var invoicePayload = {
			requestId: invoiceRequestId, referenceId: payment.id,
			vendorNumber: context.vendorNumber, vendorSiteCode: context.vendorSiteCode,
			entity: context.entity, invoiceType: 'STANDARD', invoiceDate: accountingDate,
			currency: vendorRow.currency,
			amount: invoiceAmount,
			amountPay: amountPay,
			description: payment.description,
			maker: context.maker, checker: context.checker, cashout: context.cashout,
			contractId: payment.contract_id, liabilityAccount: liabilityAccount,
			invoiceLineList: apLines, applyList: applyList,
			vatList: getVatList(payment.id, context.vendorNumber, vendorRow.payment_vendor_count)
		};
		var invoiceValidation = validateInvoicePayload(invoicePayload);
		if (!invoiceValidation.success) return invalidPayload('AP_INVOICE', invoiceValidation, invoicePayload);
		result.push(makePrepared(invoiceRequestId, TYPE_AP, SUB_PAYMENT,
				vendorRow.vendor_id, invoiceAmount, invoicePayload, apEntryIds));
	}

	for (var pp = 0; pp < payablePayments.length; pp++) {
		var payableEntry = payablePayments[pp];
		var invoiceNumber = safeString(payableEntry.ref_id).trim();
		if (!invoiceNumber) return errorResult(
				'Entry ' + payableEntry.id + ' cua TT-17 thieu ref.id (ma giao dich YCTT cu).');
		var paymentRequestId = uuid();
		var paymentPayload = {
			requestId: paymentRequestId, referenceId: payment.id,
			vendorNumber: context.vendorNumber, entity: context.entity,
			invoiceNumber: invoiceNumber, currency: payableEntry.currency,
			amount: payableEntry.amount, maker: context.maker, checker: context.checker,
			cashout: context.cashout, contractId: payment.contract_id
		};
		var paymentValidation = validatePaymentPayload(paymentPayload);
		if (!paymentValidation.success) return invalidPayload('AP_PAYMENT', paymentValidation, paymentPayload);
		result.push(makePrepared(paymentRequestId, TYPE_AP, SUB_PAYMENT,
				vendorRow.vendor_id, payableEntry.amount, paymentPayload, [payableEntry.id]));
	}

	if (glEntries.length) {
		var glRequestId = uuid();
		var glPayloadResult = mapGlPayload(glRequestId, accountingDate, payment, vendorRow,
				context, glEntries);
		if (!glPayloadResult.success) return glPayloadResult;
		result.push(makePrepared(glRequestId, TYPE_GL, SUB_PAYMENT,
				vendorRow.vendor_id, sumEntryAmounts(glEntries), glPayloadResult.data, entryIds(glEntries)));
	}
	for (var c = 0; c < coreEntries.length; c++) {
		var coreRequestId = uuid();
		var core = mapCorePayload(coreRequestId, coreEntries[c], context);
		result.push(makePrepared(coreRequestId, TYPE_CORE, core.subType,
				vendorRow.vendor_id, coreEntries[c].amount, core.data, [coreEntries[c].id]));
	}
	return { success: true, data: result };
}

function makePrepared(requestId, type, subType, vendorId, amount, payload, entryIdList) {
	return { requestId: requestId, type: type, subType: subType, vendorId: vendorId,
		amount: amount, payload: payload, entryIds: uniqueText(entryIdList) };
}

function buildAccountingInformationRow(payment, item, createdTime) {
	return {
		'request.id': item.requestId, 'payment.id': payment.id,
		'vendor.id': item.vendorId, type: item.type, 'sub.type': item.subType,
		data: JSON.stringify(item.payload), status: STATUS_CREATED, message: '', response: '',
		'transaction.id': '', 'ref.id': '', 'ap.code': '', 'batch.name': '',
		'created.time': createdTime, 'checked.time': null,
		amount: item.amount, 'contract.id': payment.contract_id
	};
}

function buildVendorContext(payment, vendorRow) {
	var vendor = selectOne(TABLE_VENDOR, 'id="' + escapeQueryValue(vendorRow.vendor_id) + '"', function (f) {
		return { number: readText(f, 'vendor.number'), name: readText(f, 'vendor.name') };
	});
	var vendorSiteCode = getVendorSiteCode(vendorRow.vendor_site_id, vendorRow.vendor_id);
	if (!vendorSiteCode) {
		var debugInfo = [];
		var f = new SCFile(TABLE_VENDOR_SITE, SCFILE_READONLY);
		var rc = f.doSelect('vendor.id="' + escapeQueryValue(vendorRow.vendor_id) + '"');
		while (rc === RC_SUCCESS) {
			debugInfo.push({
				id: readText(f, 'id').trim(),
				vendorId: readText(f, 'vendor.id').trim(),
				siteCode: readText(f, 'ogl.site.code').trim()
			});
			rc = f.getNext();
		}
		closeFile(f);
		return errorResult('Khong tim thay vendorSiteCode cho vendorSiteId="' + vendorRow.vendor_site_id + 
			'" va vendorId="' + vendorRow.vendor_id + '". Cac site cua vendor nay trong DB: ' + JSON.stringify(debugInfo));
	}
	var entityResult = entityByUser(payment.created_by);
	if (!vendor || !vendor.number) return errorResult('Khong tim thay vendor.number cua NCC ' + vendorRow.vendor_id + '.');
	if (!entityResult.success) return entityResult;
	var maker = safeString(payment.created_by).trim();
	var checker = safeString(payment.user_checker_kttc).trim();
	var cashout = mapPaymentMethodToCashout(vendorRow.payment_method);
	if (!cashout) {
		return errorResult('Khong map duoc payment.method="' + vendorRow.payment_method + '" sang cashout.');
	}
	return { success: true, data: {
		vendorNumber: vendor.number,
		vendorSiteCode: vendorSiteCode,
		entity: entityResult.data,
		segment1: entityResult.segment1, maker: maker, checker: checker,
		cashout: cashout,
		beneficiaryBank: vendorRow.beneficiary_bank
	} };
}

function getVendorSiteCode(vendorSiteId, vendorId) {
	if (!vendorSiteId) return '';

	var exact = selectOne(TABLE_VENDOR_SITE, 'id="' + escapeQueryValue(vendorSiteId) + '"', function (f) {
		return safeString(readText(f, 'ogl.site.code')).trim();
	});
	if (exact) return exact;

	var f = new SCFile(TABLE_VENDOR_SITE, SCFILE_READONLY);
	var query = vendorId ? 'vendor.id="' + escapeQueryValue(vendorId) + '"' : '';
	var rc;
	var onlyCandidate = '';
	var candidateCount = 0;
	try {
		rc = f.doSelect(query);
		while (rc === RC_SUCCESS) {
			candidateCount++;
			var code = safeString(readText(f, 'ogl.site.code')).trim();
			onlyCandidate = code;
			if (lookupIdsEqual(readText(f, 'id'), vendorSiteId)) {
				closeFile(f);
				return code;
			}
			rc = f.getNext();
		}
	} catch (e) {
		// ignore
	}
	closeFile(f);

	if (candidateCount === 1) {
		return onlyCandidate;
	}
	return '';
}

function lookupIdsEqual(left, right) {
	var a = safeString(left).trim();
	var b = safeString(right).trim();
	if (a === b) return true;
	if (/^\d+$/.test(a) && /^\d+$/.test(b)) {
		return Number(a) === Number(b);
	}
	return false;
}

function formatSegment1(branch, defaultSegment1) {
	var br = safeString(branch).trim();
	if (br.length === 7 && br.substring(0, 2) === '10') {
		return br;
	}
	if (br.length === 3 && /^\d+$/.test(br)) {
		return '10' + br + '98';
	}
	return defaultSegment1;
}

function formatSegment2(segment1, department) {
	var seg1 = safeString(segment1).trim();
	var dept = safeString(department).trim();
	if (seg1.length === 7 && seg1.substring(0, 2) === '10') {
		var prefix = seg1.substring(0, 5); // 10xxx
		var suffix = '00';
		if (dept.length === 9) {
			suffix = dept.substring(7, 9); // yy (last 2 digits)
		} else if (dept.length === 6) {
			suffix = dept.substring(4, 6); // yy (last 2 digits)
		} else if (dept.length === 7 && dept.substring(0, 2) === '10') {
			suffix = dept.substring(5, 7); // yy (last 2 digits)
		} else if (dept.length === 2) {
			suffix = dept;
		}
		return prefix + suffix; // 10xxxyy (7 characters)
	}
	if (dept.length === 9 && dept.charAt(0) === '0') {
		return dept.substring(2, 8); // 6 characters
	}
	return dept.length === 6 ? dept : SEGMENT_2_DEFAULT;
}

function mapInvoiceLine(entry, defaultSegment1) {
	var segment1 = formatSegment1(entry.branch, defaultSegment1);
	return { lineNum: entry.order, amount: entry.amount,
		segment1: segment1,
		segment2: formatSegment2(segment1, entry.department),
		segment3: entry.account_number, segment4: SEGMENT_4_DEFAULT,
		segment5: SEGMENT_5_DEFAULT,
		segment6: safeString(entry.transaction_code).trim() || SEGMENT_6_DEFAULT,
		segment7: SEGMENT_7_DEFAULT, description: entry.description };
}

function mapGlPayload(requestId, accountingDate, payment, vendorRow, context, entries) {
	var lines = [];
	for (var i = 0; i < entries.length; i++) {
		var debit = isDebit(entries[i].account_type);
		var segment1 = SEGMENT_1_DEFAULT;
		if (safeString(entries[i].branch).trim() !== '000') {
			var segment1Result = mapEntityCodeByTransactionCode('98', entries[i].branch);
			if (!segment1Result.success) return segment1Result;
			segment1 = segment1Result.data;
		}
		var segment6 = SEGMENT_6_DEFAULT;
		var transactionCode = safeString(entries[i].transaction_code).trim();
		if (transactionCode && transactionCode !== SEGMENT_6_DEFAULT) {
			var segment6Result = mapEntityCodeByTransactionCode(transactionCode, entries[i].branch);
			if (!segment6Result.success) return segment6Result;
			segment6 = segment6Result.data;
		}
		var finalSegment1 = formatSegment1(entries[i].branch, segment1);
		lines.push({ segment1: finalSegment1,
			segment2: formatSegment2(finalSegment1, entries[i].department),
			segment3: entries[i].account_number, segment4: SEGMENT_4_DEFAULT,
			segment5: SEGMENT_5_DEFAULT,
			segment6: segment6,
			segment7: SEGMENT_7_DEFAULT,
			enteredDR: debit ? entries[i].amount : 0, enteredCR: debit ? 0 : entries[i].amount,
			accountedDR: debit ? entries[i].amount : 0, accountedCR: debit ? 0 : entries[i].amount,
			lineDesc: entries[i].description });
	}
	return { success: true, data: { requestId: requestId, accountingDate: accountingDate,
		currencyCode: vendorRow.currency, transactionDesc: vendorRow.transaction_des || payment.description,
		branchCode: entries[0].branch, source: 'QLTS', category: entries[0].type,
		createdby: context.maker, approvedby: context.checker, line: lines,
		text1: '', text2: '', text3: '', text4: '', text5: '' } };
}

function mapCorePayload(requestId, entry, context) {
	var bankParts = safeString(context.beneficiaryBank).split('|');
	var internal = safeString(bankParts[2]).trim() === VIETINBANK_NAPAS;
	var amount = safeString(toNumber(entry.amount));
	var description = normalizeBusinessText(entry.description).toUpperCase();
	var clientDate = safeString(lib.ESD_HTKT_Utils.formatDateToISOWithOffset()).trim();
	if (internal) return { subType: SUB_INHOUSE, data: {
		requestId: requestId, clientDt: clientDate, channel: 'A101_IBR',
		spname: 'com.xesapi.xferadd20.FunsTransferAdd', data: {
			depAcctIdFrom: { acctId: '1111', acctCur: entry.currency },
			depAcctIdTo: { acctId: entry.account_number, acctCur: entry.currency },
			amount: amount, curCode: entry.currency, reversedInd: 'N',
			trnRefNum: requestId, notes: description } } };
	return { subType: SUB_CITAD, data: {
		requestId: requestId, clientDt: clientDate, channel: 'A101_IBR', reftype: 'IB',
		spname: 'com.fnf.xes.PRF', data: {
			serviceBranch: '', pmtType: 'Outgoing IBPS_Bilateral', pmtMethod: 'Account',
			trnType: 'Transaction Internet Banking', fromAcctId: '101870783864',
			toAcctId: entry.account_number, toBankId: safeString(bankParts[1]).trim(),
			toBranchId: safeString(bankParts[0]).trim(), toAcctName: truncate(entry.account_name, 150),
			amount: [{ amount: amount, crcd: entry.currency, amountType: 'TRAN_AMOUNT' }],
			trnDesc: truncate(description, 269), chanRefNum: requestId } } };
}

function validateInvoicePayload(p) {
	var missing = requiredFields(p, ['requestId','referenceId','vendorNumber','vendorSiteCode',
		'entity','invoiceDate','currency','maker','checker','cashout','contractId']);
	var invalid = [];
	if (toNumber(p.amount) <= 0) missing.push('amount');
	if (!p.invoiceLineList.length) missing.push('invoiceLineList');
	if (safeString(p.currency).length !== 3) invalid.push('currency');
	if (p.cashout !== CASH_YES && p.cashout !== CASH_NO) invalid.push('cashout');
	if (toNumber(p.amountPay) < 0) invalid.push('amountPay');
	validateInvoiceLines(p.invoiceLineList, invalid);
	validateApplyList(p.applyList, invalid);
	validateVatList(p.vatList, invalid);
	return { success: missing.length === 0 && invalid.length === 0,
		missingFields: uniqueText(missing), invalidFields: uniqueText(invalid) };
}

function validatePaymentPayload(p) {
	var missing = requiredFields(p, ['requestId','referenceId','vendorNumber','entity',
		'invoiceNumber','currency','maker','checker','cashout','contractId']);
	var invalid = [];
	if (toNumber(p.amount) <= 0) missing.push('amount');
	if (safeString(p.currency).length !== 3) invalid.push('currency');
	if (p.cashout !== CASH_YES && p.cashout !== CASH_NO) invalid.push('cashout');
	return { success: missing.length === 0 && invalid.length === 0,
		missingFields: uniqueText(missing), invalidFields: uniqueText(invalid) };
}

function validateInvoiceLines(lines, invalid) {
	var lengths = { segment1: 7, segment2: 6, segment3: 9,
		segment4: 7, segment5: 7, segment6: 7, segment7: 7 };
	for (var i = 0; i < lines.length; i++) {
		var line = lines[i];
		if (toNumber(line.lineNum) <= 0) invalid.push('invoiceLineList[' + i + '].lineNum');
		if (toNumber(line.amount) <= 0) invalid.push('invoiceLineList[' + i + '].amount');
		for (var field in lengths) {
			if (lengths.hasOwnProperty(field)) {
				var len = safeString(line[field]).length;
				if (field === 'segment2') {
					if (len !== 6 && len !== 7) {
						invalid.push('invoiceLineList[' + i + '].' + field);
					}
				} else {
					if (len !== lengths[field]) {
						invalid.push('invoiceLineList[' + i + '].' + field);
					}
				}
			}
		}
	}
}

function validateApplyList(rows, invalid) {
	for (var i = 0; i < rows.length; i++) {
		if (!safeString(rows[i].invoiceNumber).trim()) invalid.push('applyList[' + i + '].invoiceNumber');
		if (toNumber(rows[i].amount) <= 0) invalid.push('applyList[' + i + '].amount');
	}
}

function validateVatList(rows, invalid) {
	var allowed = { KHONG_KHAU_TRU: true, KHAU_TRU_TY_LE: true, KHAU_TRU_TOAN_BO: true };
	for (var i = 0; i < rows.length; i++) {
		if (!safeString(rows[i].id).trim()) invalid.push('vatList[' + i + '].id');
		if (!allowed[safeString(rows[i].discountType).trim()]) invalid.push('vatList[' + i + '].discountType');
	}
}

function requiredFields(object, names) {
	var result = [];
	for (var i = 0; i < names.length; i++) if (!safeString(object[names[i]]).trim()) result.push(names[i]);
	return result;
}

function invalidPayload(kind, validation, payload) {
	return { success: false, code: 'INVALID_' + kind + '_PAYLOAD',
		error: 'Payload ' + kind + ' thieu hoac sai du lieu.',
		missingFields: validation.missingFields || [],
		invalidFields: validation.invalidFields || [], data: payload };
}

function getPayment(paymentId) {
	return selectOne(TABLE_PAYMENT, 'id="' + escapeQueryValue(paymentId) + '"', function (f) {
		return { id: readText(f, 'id').trim(), current_phase: readText(f, 'current.phase').trim(),
			description: readText(f, 'description').trim(), contract_id: readText(f, 'contract.id').trim(),
			created_by: readText(f, 'created.by').trim(),
			user_checker_kttc: readText(f, 'user.checker.kttc').trim() };
	}) || {};
}

function getPaymentVendors(paymentId) {
	return selectMany(TABLE_VENDOR_ROW, 'payment.id="' + escapeQueryValue(paymentId) + '"', function (f) {
		return { payment_id: readText(f, 'payment.id').trim(), vendor_id: readText(f, 'vendor.id').trim(),
			vendor_site_id: readText(f, 'vendor.site.id').trim(),
			approved_invoice_amount: readNumber(f, 'approved.invoice.amount'), amount: readNumber(f, 'amount'),
			refund_amount: readNumber(f, 'refund.amount'), vendor_type: readText(f, 'vendor.type').trim(),
			currency: readText(f, 'currency').trim(),
			payment_method: readText(f, 'payment.method').trim(), beneficiary_bank: readText(f, 'beneficiary.bank').trim(),
			transaction_des: readText(f, 'transaction.des').trim() };
	});
}

function getPaymentEntries(paymentId) {
	var rows = selectMany(TABLE_ENTRY, 'payment.id="' + escapeQueryValue(paymentId) + '"', function (f) {
		return { id: readText(f, 'id').trim(), payment_id: readText(f, 'payment.id').trim(),
			entry_type: readText(f, 'entry.type').trim(), ledger_type: readText(f, 'ledger.type').trim(),
			account_type: readText(f, 'account.type').trim(), account_number: readText(f, 'account.number').trim(),
			account_name: readText(f, 'account.name').trim(), branch: readText(f, 'branch').trim(),
			department: readText(f, 'department').trim(), transaction_code: readText(f, 'transaction.code').trim(),
			amount: readNumber(f, 'amount'), currency: readText(f, 'currency').trim(),
			description: readText(f, 'description').trim(), vendor_id: readText(f, 'vendor.id').trim(),
			type: readText(f, 'type').trim(), order: readNumber(f, 'order'), ref_id: readText(f, 'ref.id').trim() };
	});
	rows.sort(function (a, b) { return toNumber(a.order) - toNumber(b.order); });
	return rows;
}

function getVatList(paymentId, vendorNumber, vendorCount) {
	var result = [];
	var links = selectMany(TABLE_PAYMENT_INVOICE,
			'payment.id="' + escapeQueryValue(paymentId) + '"', function (f) {
				return { invoiceId: readText(f, 'invoice.id'), deductionType: readText(f, 'deduction.type') };
			});
	for (var i = 0; i < links.length; i++) {
		var invoice = selectOne(TABLE_INVOICE, 'id="' + escapeQueryValue(links[i].invoiceId) + '"', function (f) {
			return { id: readText(f, 'id'), taxCode: readText(f, 'seller.tax.code') };
		});
		if (invoice && (toNumber(vendorCount) === 1 ||
				normalizeIdentity(invoice.taxCode) === normalizeIdentity(vendorNumber))) {
			result.push({ id: invoice.id, discountType: mapDiscountType(links[i].deductionType) });
		}
	}
	return result;
}

function mapDiscountType(value) {
	var v = normalizeIdentity(value);
	if (v === 'khautru001' || v === 'khautrutoanbo') return 'KHAU_TRU_TOAN_BO';
	if (v === 'khautru002' || v === 'khautrutyle') return 'KHAU_TRU_TY_LE';
	return 'KHONG_KHAU_TRU';
}

function mapPaymentMethodToCashout(value) {
	var normalized = normalizeIdentity(value);
	if (normalized === 'tienmat') return CASH_YES;
	if (normalized === 'chuyenkhoan') return CASH_NO;
	return '';
}

function entityByUser(userName) {
	var creator = safeString(userName).trim();
	if (!creator) return errorResult('Thieu ' + TABLE_PAYMENT + '.created.by.');

	var lv1Id = selectOne(TABLE_CONTACT, 'contact.name="' + escapeQueryValue(creator) + '"', function (f) {
		return readText(f, 'lv1.id').trim();
	});
	if (!lv1Id) {
		return errorResult('Khong tim thay contacts.lv1.id cua contact.name="' + creator + '".');
	}

	/* Giữ nguyên lv1.id làm ps.code, đúng như code Tạm ứng; không tự cắt ký tự. */
	var entityCodes = selectMany(
			TABLE_ENTITY,
			'ps.code="' + escapeQueryValue(lv1Id) + '"',
			function (f) { return readText(f, 'entity.code').trim(); }
	);
	var uniqueCodes = uniqueText(entityCodes);
	if (!uniqueCodes.length) {
		return errorResult('Khong tim thay entity.code voi ps.code="' + lv1Id + '".');
	}
	if (uniqueCodes.length > 1) {
		return errorResult('Tim thay nhieu entity.code voi ps.code="' + lv1Id + '".');
	}

	return {
		success: true,
		data: uniqueCodes[0],
		segment1: uniqueCodes[0]
	};
}

/** Mapping GL giữ nguyên quy tắc từ file AccountingInformation của Tạm ứng. */
function mapEntityCodeByTransactionCode(transactionCode, branchCode) {
	var code = safeString(transactionCode).trim();
	if (!code) return errorResult('Thieu ' + TABLE_ENTRY + '.transaction.code.');
	var branch = safeString(branchCode).trim();
	if (!branch) return errorResult('Thieu ' + TABLE_ENTRY + '.branch de map entity.code.');
	var oglBranchCode = '0' + branch;
	var entityCodes = selectMany(
			TABLE_ENTITY,
			'org.transaction.code="' + escapeQueryValue(code) +
			'" and ogl.branch.code="' + escapeQueryValue(oglBranchCode) + '"',
			function (f) { return readText(f, 'entity.code').trim(); }
	);
	var uniqueCodes = uniqueText(entityCodes);
	if (!uniqueCodes.length) {
		return errorResult(
				'Khong tim thay entity.code voi org.transaction.code="' + code +
				'" va ogl.branch.code="' + oglBranchCode + '".'
		);
	}
	if (uniqueCodes.length > 1) {
		return errorResult(
				'Tim thay nhieu entity.code voi org.transaction.code="' + code +
				'" va ogl.branch.code="' + oglBranchCode + '".'
		);
	}
	return { success: true, data: uniqueCodes[0] };
}

function filterEntriesByVendor(entries, vendorId) {
	var result = [];
	for (var i = 0; i < entries.length; i++) if (safeString(entries[i].vendor_id) === safeString(vendorId)) result.push(entries[i]);
	return result;
}

function updateEntryRequestId(entryId, paymentId, requestId) {
	var f;
	try {
		f = new SCFile(TABLE_ENTRY);
		var rc = f.doSelect('id="' + escapeQueryValue(entryId) + '" and payment.id="' + escapeQueryValue(paymentId) + '"');
		if (rc === RC_SUCCESS) { f['accounting.request.id'] = requestId; rc = f.doUpdate(); }
		return rc;
	} finally { closeFile(f); }
}

function clearEntryRequestIds(paymentId) {
	var f, updated = 0;
	try {
		f = new SCFile(TABLE_ENTRY);
		var rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');
		while (rc === RC_SUCCESS) { f['accounting.request.id'] = ''; if (f.doUpdate() === RC_SUCCESS) updated++; rc = f.getNext(); }
	} finally { closeFile(f); }
	return updated;
}

function deleteAccountingInformation(paymentId) {
	var deleted = 0, f;
	try {
		f = new SCFile(TABLE_AI);
		var rc = f.doSelect('payment.id="' + escapeQueryValue(paymentId) + '"');
		while (rc === RC_SUCCESS) { if (f.doDelete() === RC_SUCCESS) deleted++; rc = f.getNext(); }
	} finally { closeFile(f); }
	return deleted;
}

function insertRecord(table, row) {
	var f;
	try { f = new SCFile(table); for (var k in row) if (row.hasOwnProperty(k)) f[k] = row[k]; return f.doInsert(); }
	finally { closeFile(f); }
}

function selectOne(table, query, mapper) {
	var f;
	try { f = new SCFile(table, SCFILE_READONLY); return f.doSelect(query) === RC_SUCCESS ? mapper(f) : null; }
	finally { closeFile(f); }
}

function selectMany(table, query, mapper) {
	var rows = [], f;
	try {
		f = new SCFile(table, SCFILE_READONLY);
		var rc = f.doSelect(query);
		while (rc === RC_SUCCESS) { rows.push(mapper(f)); rc = f.getNext(); }
	} finally { closeFile(f); }
	return rows;
}

function getInputDetails(input) {
	var result = {};
	copyObject(result, parseObject(input.details)); copyObject(result, parseObject(input.queryString));
	if (!result.paymentId) result.paymentId = readText(input, 'payment.id') || readText(input, 'paymentId');
	return result;
}

function parseObject(value) {
	if (!value) return {}; if (typeof value === 'object') return value;
	try { var parsed = JSON.parse(value); return parsed && typeof parsed === 'object' ? parsed : {}; } catch (e) { return {}; }
}

function copyObject(target, source) { for (var k in source) if (source.hasOwnProperty(k)) target[k] = source[k]; }
function readText(record, field) { var v = readField(record, field); return v === null || v === undefined ? '' : String(v); }
function readNumber(record, field) { return toNumber(readField(record, field)); }
function readField(record, field) { try { return record[field]; } catch (e) { return ''; } }
function isDebit(value) { var v = normalizeIdentity(value); return v === 'no' || v === 'debit'; }
function isCredit(value) { var v = normalizeIdentity(value); return v === 'co' || v === 'credit' || v === 'asset' || v === 'taisan'; }
function isBankTransfer(value) { return normalizeIdentity(value) === 'chuyenkhoan'; }
function sumEntryAmounts(rows) { var n = 0; for (var i = 0; i < rows.length; i++) n += toNumber(rows[i].amount); return n; }
function sumInvoiceLineAmounts(rows) { var n = 0; for (var i = 0; i < rows.length; i++) n += toNumber(rows[i].amount); return n; }
function entryIds(rows) { var r = []; for (var i = 0; i < rows.length; i++) r.push(rows[i].id); return r; }
function uuid() { var value = safeString(lib.UUID.generateUUID()).trim().toLowerCase(); if (!value) throw new Error('Khong the sinh UUID.'); return value; }
function dateYmd(value) { var m = value.getMonth() + 1, d = value.getDate(); return value.getFullYear() + '-' + (m < 10 ? '0' : '') + m + '-' + (d < 10 ? '0' : '') + d; }
function truncate(value, length) { var s = safeString(value).trim(); return s.length > length ? s.substring(0, length).trim() : s; }
function toNumber(value) { if (value === null || value === undefined || value === '') return 0; var n = Number(String(value).replace(/,/g, '').trim()); return isNaN(n) ? 0 : n; }
function normalizeBusinessText(value) { var s = safeString(value).toLowerCase(); try { if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); } catch (e) {} return s.replace(/\u0111/g, 'd').replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function normalizeIdentity(value) { return normalizeBusinessText(value).replace(/[^a-z0-9]/g, ''); }
function safeString(value) { return value === null || value === undefined ? '' : String(value); }
function escapeQueryValue(value) { return safeString(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"'); }
function uniqueText(values) { var seen = {}, r = []; for (var i = 0; i < values.length; i++) { var v = safeString(values[i]); if (v && !seen[v]) { seen[v] = true; r.push(v); } } return r; }
function errorResult(message) { return { success: false, error: message }; }
function closeFile(file) { try { if (file) file.doClose(); } catch (e) {} }
