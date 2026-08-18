var HTKT_COMMON = lib.ESD_HTKT_PAYMENT_COMMON;
var HTKT_TABLE = HTKT_COMMON.getTables();

var HTKT_DOC_SERVICE_BASE_URL = HTKT_COMMON.trim(lib.ESD_ENV_CONFIG.gendocUrl()).replace(/\/$/, "");
var HTKT_DOC_GENERATE_PDF_BASE64_PATH = "/api/generate/pdf/base64"
var HTKT_DOC_HTTP_TIMEOUT = 300;
var HTKT_DOC_MAX_BASE64_LENGTH = 5000000;


var HTKT_CASH_TEMPLATE_ID = "ef740dce-17ac-4949-9238-65df29acc009";
var HTKT_CASH_TEMPLATE_CODE = "HTKT-10-TTTM";
var HTKT_TRANSFER_TEMPLATE_ID = "2231502e-4a8f-40b9-9fe9-42e6970d951a";
var HTKT_TRANSFER_TEMPLATE_CODE = "HTKT-10-TTCK";
var HTKT_PAYMENT_RECIPIENT = "Lãnh đạo đơn vị";



/* =============================================================================
 * 5. MAP DỮ LIỆU TEMPLATE 01/TTTM VÀ 04/TTCK
 * ============================================================================= */

var HTKT_DEDUCTION_TYPE_FULL = "KHAUTRU_001";
var HTKT_DEDUCTION_TYPE_RATE = "KHAUTRU_002";
var HTKT_ENTRY_TYPE_AP = "AP";
var HTKT_ENTRY_TYPE_GL = "GL";
/* Giá trị của trường PaymentEntry.entry.type. */
var HTKT_ACCOUNTING_ENTRY_COST = "COST";
var HTKT_ACCOUNTING_ENTRY_PREPAYMENT = "PREPAYMENT";
var HTKT_ACCOUNTING_ENTRY_TAX = "TAX";
var HTKT_ACCOUNTING_ENTRY_PAYABLE = "PAYABLE";
var HTKT_ACCOUNTING_ENTRY_CUSTOMER = "CUSTOMER";
var HTKT_VENDOR_INFO_CACHE = {};
var HTKT_BANK_NAME_CACHE = {};

function htktGetVendorInfo(vendorId) {
	var safeVendorId = HTKT_COMMON.trim(vendorId);
	var vendorFile = null;
	var info = null;

	if (!safeVendorId) {
		return { id: "", name: "", tax_code: "" };
	}

	if (HTKT_VENDOR_INFO_CACHE[safeVendorId]) {
		return HTKT_VENDOR_INFO_CACHE[safeVendorId];
	}

	vendorFile = HTKT_COMMON.selectOne(
			HTKT_TABLE.VENDOR,
			["id"],
			safeVendorId
	);
	info = {
		id: safeVendorId,
		name: vendorFile
				? HTKT_COMMON.readString(vendorFile, ["vendor.name"])
				: "",
		tax_code: vendorFile
				? HTKT_COMMON.readString(vendorFile, ["vendor.number"])
				: ""
	};

	HTKT_COMMON.closeFile(vendorFile);
	HTKT_VENDOR_INFO_CACHE[safeVendorId] = info;
	return info;
}

function htktGetFirstBeneficiaryBankCitadCode(value) {
	var bankValue = HTKT_COMMON.trim(value);
	var separatorIndex = bankValue.indexOf("|");

	if (!bankValue) {
		return "";
	}

	return HTKT_COMMON.trim(
			separatorIndex >= 0
					? bankValue.substring(0, separatorIndex)
					: bankValue
	);
}

function htktGetBankNameByCitadCode(citadCode) {
	var safeCitadCode = HTKT_COMMON.trim(citadCode);
	var bankFile = null;
	var bankName = "";

	if (!safeCitadCode) {
		return "";
	}

	if (Object.prototype.hasOwnProperty.call(
			HTKT_BANK_NAME_CACHE,
			safeCitadCode
	)) {
		return HTKT_BANK_NAME_CACHE[safeCitadCode];
	}

	bankFile = HTKT_COMMON.selectOne(
			HTKT_TABLE.BANK,
			["citad.branch.code", "citad.code", "code", "napas.code", "id", "name"],
			safeCitadCode
	);

	if (bankFile) {
		bankName = HTKT_COMMON.readString(bankFile, ["name", "bank.name", "full.name"]);
	}

	HTKT_COMMON.closeFile(bankFile);
	HTKT_BANK_NAME_CACHE[safeCitadCode] = bankName;
	return bankName;
}

function htktResolveBeneficiaryBankName(beneficiaryBank, directBankName) {
	var direct = HTKT_COMMON.trim(directBankName);
	if (direct) {
		return direct;
	}

	var rawValue = HTKT_COMMON.trim(beneficiaryBank);
	if (!rawValue) {
		return "";
	}

	if (Object.prototype.hasOwnProperty.call(HTKT_BANK_NAME_CACHE, rawValue)) {
		return HTKT_BANK_NAME_CACHE[rawValue];
	}

	var parts = rawValue.split("|");
	var bankName = "";

	for (var i = 0; i < parts.length; i++) {
		var code = HTKT_COMMON.trim(parts[i]);
		if (!code) {
			continue;
		}

		bankName = htktGetBankNameByCitadCode(code);
		if (bankName) {
			break;
		}
	}

	if (!bankName) {
		bankName = htktGetBankNameByCitadCode(rawValue);
	}

	if (!bankName && isNaN(rawValue) && rawValue.indexOf("|") === -1) {
		bankName = rawValue;
	}

	HTKT_BANK_NAME_CACHE[rawValue] = bankName;
	return bankName;
}

function htktGetPaymentVendorSourceRows(paymentId, defaultCurrency) {
	var result = [];
	var vendorFile = null;
	var rc = null;

	try {
		vendorFile = HTKT_COMMON.newReadOnlyFile(
				HTKT_TABLE.PAYMENT_VENDOR
		);
		rc = vendorFile.doSelect(
				'payment.id="' +
				HTKT_COMMON.escapeQueryValue(paymentId) +
				'"'
		);

		while (rc === RC_SUCCESS) {
			var vendorId = HTKT_COMMON.readString(vendorFile, ["vendor.id"]);
			var vendorInfo = htktGetVendorInfo(vendorId);
			var paymentMethod = HTKT_COMMON.readString(
					vendorFile,
					["payment.method"]
			);
			var beneficiaryBank = HTKT_COMMON.readString(
					vendorFile,
					["beneficiary.bank", "beneficiary_bank"]
			);
			var vendorBankName = HTKT_COMMON.readString(
					vendorFile,
					["bank.name", "bank_name", "beneficiary.bank.name", "beneficiary_bank_name"]
			);
			var resolvedBankName = htktResolveBeneficiaryBankName(
					beneficiaryBank,
					vendorBankName
			);
			var amountRaw = HTKT_COMMON.readNumber(vendorFile, ["amount"]);

			result.push({
				vendor_id: vendorId,
				vendor_name:  HTKT_COMMON.readString(
						vendorFile,
						["transaction.des"]
				),
				vendor_tax_code: vendorInfo.tax_code,
				vendor_site_id: HTKT_COMMON.readString(
						vendorFile,
						["vendor.site.id"]
				),
				payment_method: paymentMethod,
				beneficiary_account: HTKT_COMMON.readString(
						vendorFile,
						["beneficiary.account"]
				),
				beneficiary_name: HTKT_COMMON.readString(
						vendorFile,
						["beneficiary.name"]
				),
				beneficiary_bank: beneficiaryBank,
				beneficiary_bank_name: resolvedBankName,
				transaction_des: HTKT_COMMON.readString(
						vendorFile,
						["transaction.des"]
				),
				identity_number: HTKT_COMMON.readString(
						vendorFile,
						["identity.number"]
				),
				issued_date_raw: HTKT_COMMON.readValue(
						vendorFile,
						["issued.date"]
				),
				issued_place: HTKT_COMMON.readString(
						vendorFile,
						["issued.place"]
				),
				phone: HTKT_COMMON.readString(vendorFile, ["phone"]),
				amount_raw: amountRaw,
				/* Số tiền hoàn ứng lần này trên chi tiết đề nghị theo NCC. */
				refund_amount_raw: HTKT_COMMON.readNumber(
						vendorFile,
						["refund.amount"]
				),
				currency: HTKT_COMMON.readString(vendorFile, ["currency"]) ||
						defaultCurrency
			});

			rc = vendorFile.getNext();
		}
	} catch (eVendorRows) {
		result = [];
	}

	HTKT_COMMON.closeFile(vendorFile);
	return result;
}

function htktFindInvoiceVendorId(sourceRows, sellerTaxCode) {
	var normalizedSellerTaxCode = HTKT_COMMON.htktNormalizePaymentMethod(sellerTaxCode);

	if (normalizedSellerTaxCode) {
		for (var i = 0; i < sourceRows.length; i++) {
			if (
					HTKT_COMMON.htktNormalizePaymentMethod(sourceRows[i].vendor_tax_code) ===
					normalizedSellerTaxCode
			) {
				return sourceRows[i].vendor_id;
			}
		}
	}

	return sourceRows.length === 1 ? sourceRows[0].vendor_id : "";
}

function htktGetDeductibleTaxByVendor(paymentId, sourceRows) {
	var taxByVendor = {};
	var invoiceLinkFile = null;
	var rc = null;

	try {
		invoiceLinkFile = HTKT_COMMON.newReadOnlyFile(
				HTKT_TABLE.PAYMENT_INVOICE
		);
		rc = invoiceLinkFile.doSelect(
				'payment.id="' +
				HTKT_COMMON.escapeQueryValue(paymentId) +
				'"'
		);

		while (rc === RC_SUCCESS) {
			var deductionType = HTKT_COMMON.readString(
					invoiceLinkFile,
					["deduction.type"]
			).toUpperCase();

			if (
					(
							deductionType === HTKT_DEDUCTION_TYPE_FULL ||
							deductionType === HTKT_DEDUCTION_TYPE_RATE
					)
			) {
				var invoiceId = HTKT_COMMON.readString(
						invoiceLinkFile,
						["invoice.id"]
				);
				var invoiceFile = HTKT_COMMON.selectOne(
						HTKT_TABLE.INVOICE,
						["id"],
						invoiceId
				);

				if (invoiceFile) {
					var vendorId = htktFindInvoiceVendorId(
							sourceRows,
							HTKT_COMMON.readString(invoiceFile, ["seller.tax.code"])
					);
					var taxRaw = HTKT_COMMON.readNumber(invoiceFile, ["total.tax"]);

					if (vendorId && taxRaw > 0) {
						taxByVendor[vendorId] =
								Number(taxByVendor[vendorId] || 0) + taxRaw;
					}
				}

				HTKT_COMMON.closeFile(invoiceFile);
			}

			rc = invoiceLinkFile.getNext();
		}
	} catch (eInvoiceTax) {
		taxByVendor = {};
	}

	HTKT_COMMON.closeFile(invoiceLinkFile);
	return taxByVendor;
}

/*
 * Bản dùng cho EFORM của getListSupplierLedger. Hàm trả các khoản tạm ứng
 * thuộc một NCC/hợp đồng, đồng thời phân biệt hoàn ứng của phiếu hiện tại
 * với khoản đã hoàn ứng hoặc đang chờ duyệt ở phiếu khác.
 */
function htktGetSupplierLedgerRows(paymentId, vendorId, contractId) {
	var safePaymentId = HTKT_COMMON.trim(paymentId);
	var safeVendorId = HTKT_COMMON.trim(vendorId);
	var safeContractId = HTKT_COMMON.trim(contractId);
	var rowsByKey = {};
	var rowKeys = [];
	var file = null;
	var result = [];

	if (!safeVendorId || !safeContractId) {
		return result;
	}

	var query =
			"SELECT " +
			"ai.request.id AS requestId, " +
			"ai.prepayment.id AS prepaymentId, " +
			"ai.amount AS advance_amount, " +
			"pe.amount AS payment_entry_amount, " +
			"pe.payment.id AS entry_payment_id, " +
			"aip.status AS ogl_status " +
			"FROM esdHTKTaccountingInformation ai " +
			"LEFT JOIN esdHTKTpaymentEntry pe " +
			"ON (ai.prepayment.id = pe.ref.id " +
			'AND pe.entry.type = "PREPAYMENT") ' +
			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (pe.accounting.request.id = aip.request.id) " +
			'WHERE ai.sub.type = "TAM_UNG" ' +
			'AND ai.contract.id = "' +
			HTKT_COMMON.escapeQueryValue(safeContractId) + '" ' +
			'AND ai.vendor.id = "' +
			HTKT_COMMON.escapeQueryValue(safeVendorId) + '" ' +
			'AND ai.status = "COMPLETED" ' +
			'AND ai.type = "AP" ' +
			"ORDER BY ai.checked.time DESC";

	try {
		file = HTKT_COMMON.newReadOnlyFile("esdHTKTaccountingInformation");
		if (!file) {
			return result;
		}

		var rc = file.doSelect(query);
		while (rc === RC_SUCCESS) {
			var requestId = HTKT_COMMON.readString(file, [
				"requestId", "ai.request.id", "request.id"
			]);
			var prepaymentId = HTKT_COMMON.readString(file, [
				"prepaymentId", "ai.prepayment.id", "prepayment.id"
			]);
			var key = requestId + "|" + prepaymentId;
			var amountRaw = HTKT_COMMON.readNumber(file, [
				"advance_amount", "ai.amount", "amount"
			]);
			var paymentEntryAmount = HTKT_COMMON.readNumber(file, [
				"payment_entry_amount", "pe.amount"
			]);
			var entryPaymentId = HTKT_COMMON.readString(file, [
				"entry_payment_id", "pe.payment.id"
			]);
			var accountingStatus = HTKT_COMMON.toLower(
					HTKT_COMMON.readString(file, ["ogl_status", "aip.status"])
			);

			if (!rowsByKey[key]) {
				rowsByKey[key] = {
					advance_amount: amountRaw,
					refunded_amount: 0,
					other_pending_amount: 0,
					current_refund_amount: 0
				};
				rowKeys.push(key);
			}

			if (paymentEntryAmount > 0) {
				if (accountingStatus === "completed") {
					rowsByKey[key].refunded_amount += paymentEntryAmount;
				}

				if (safePaymentId && entryPaymentId === safePaymentId) {
					rowsByKey[key].current_refund_amount += paymentEntryAmount;
				} else if (
						accountingStatus !== "rejected" &&
						accountingStatus !== "cancelled" &&
						accountingStatus !== "failed" &&
						accountingStatus !== "completed" &&
						entryPaymentId
				) {
					rowsByKey[key].other_pending_amount += paymentEntryAmount;
				}
			}

			rc = file.getNext();
		}
	} catch (eSupplierLedger) {
		HTKT_COMMON.log(
				"Không lấy được công nợ NCC " + safeVendorId + ". " +
				HTKT_COMMON.exceptionToString(eSupplierLedger)
		);
		result = [];
		rowKeys = [];
	}

	HTKT_COMMON.closeFile(file);

	for (var rowIndex = 0; rowIndex < rowKeys.length; rowIndex++) {
		var row = rowsByKey[rowKeys[rowIndex]];
		row.remaining_amount = Math.max(
				row.advance_amount - row.refunded_amount - row.other_pending_amount,
				0
		);
		result.push(row);
	}

	return result;
}

function htktBuildPrepaymentTemplateTotals(
		paymentId,
		contractId,
		vendorSourceRows
) {
	var totalAdvanceRaw = 0;
	var totalRefundRaw = 0;
	var totalRemainingRaw = 0;
	var processedVendors = {};

	for (var vendorIndex = 0;
	     vendorIndex < vendorSourceRows.length;
	     vendorIndex++
	) {
		var vendor = vendorSourceRows[vendorIndex];
		var vendorId = HTKT_COMMON.trim(vendor.vendor_id);

		/* (21): cộng refund.amount của tất cả NCC trong ĐNTT. */
		totalRefundRaw += Number(vendor.refund_amount_raw || 0);

		if (!vendorId || processedVendors[vendorId]) {
			continue;
		}
		processedVendors[vendorId] = true;

		var ledgerRows = htktGetSupplierLedgerRows(
				paymentId,
				vendorId,
				contractId
		);

		for (var ledgerIndex = 0;
		     ledgerIndex < ledgerRows.length;
		     ledgerIndex++
		) {
			var ledger = ledgerRows[ledgerIndex];

			/*
			 * (20), (24): Tính tổng toàn bộ các khoản tạm ứng và còn lại
			 * của NCC / Hợp đồng trong danh sách công nợ.
			 */
			totalAdvanceRaw += Number(ledger.advance_amount || 0);
			totalRemainingRaw += Number(ledger.remaining_amount || 0);
		}
	}

	return {
		totalAdvanceRaw: totalAdvanceRaw,
		totalRefundRaw: totalRefundRaw,
		totalRemainingRaw: totalRemainingRaw
	};
}

function htktBuildVendorTemplateRows(sourceRows, taxByVendor) {
	var rows = [];
	var totalAmountBeforeTaxRaw = 0;
	var totalTaxRaw = 0;
	var totalAmountRaw = 0;
	var totalLineTotalRaw = 0;

	for (var i = 0; i < sourceRows.length; i++) {
		var source = sourceRows[i];
		var amountRaw = Number(source.amount_raw || 0);
		var taxRaw = Number(taxByVendor[source.vendor_id] || 0);
		var amountBeforeTaxRaw = Math.max(amountRaw - taxRaw, 0);
		var lineTotalRaw = amountRaw;

		rows.push({
			stt: i + 1,
			vendor_name: source.vendor_name || source.vendor_id,
			amount_before_tax: HTKT_COMMON.htktFormatMoney(amountBeforeTaxRaw),
			tax_amount: HTKT_COMMON.htktFormatMoney(taxRaw),
			line_total: HTKT_COMMON.htktFormatMoney(lineTotalRaw),
			note: ""
		});

		totalAmountBeforeTaxRaw += amountBeforeTaxRaw;
		totalTaxRaw += taxRaw;
		totalAmountRaw += lineTotalRaw;
		totalLineTotalRaw += lineTotalRaw;
	}

	return {
		rows: rows,
		totalAmountBeforeTaxRaw: totalAmountBeforeTaxRaw,
		totalTaxRaw: totalTaxRaw,
		totalAmountRaw: totalAmountRaw,
		totalLineTotalRaw: totalLineTotalRaw
	};
}

function htktResolvePaymentTemplate(sourceRows) {
	var hasCash = false;
	var hasTransfer = false;
	var invalidMethods = [];
	var invalidMethodMap = {};

	for (var i = 0; i < sourceRows.length; i++) {
		var source = sourceRows[i];
		var rawMethod = HTKT_COMMON.trim(source.payment_method);

		if (HTKT_COMMON.htktIsCashPaymentMethod(rawMethod)) {
			hasCash = true;
		} else if (HTKT_COMMON.htktIsTransferPaymentMethod(rawMethod)) {
			hasTransfer = true;
		} else {
			var invalidKey = rawMethod || "(trong)";
			if (!invalidMethodMap[invalidKey]) {
				invalidMethodMap[invalidKey] = true;
				invalidMethods.push(invalidKey);
			}
		}
	}

	if (sourceRows.length === 0) {
		return {
			success: false,
			message: "Phiếu chưa có dữ liệu esdHTKTpaymentVendor."
		};
	}

	if (invalidMethods.length > 0) {
		return {
			success: false,
			message:
					"Không xác định được mẫu cho payment.method: " +
					invalidMethods.join(", ") + "."
		};
	}

	if (hasCash && hasTransfer) {
		return {
			success: false,
			message:
					"Phiếu có cả TIENMAT và CHUYENKHOAN; " +
					"không thể map vào một biểu mẫu duy nhất."
		};
	}

	if (hasCash) {
		return {
			success: true,
			kind: "cash",
			payment_method: "TIENMAT",
			template_id: HTKT_CASH_TEMPLATE_ID,
			template_code: HTKT_CASH_TEMPLATE_CODE
		};
	}

	return {
		success: true,
		kind: "transfer",
		payment_method: "CHUYENKHOAN",
		template_id: HTKT_TRANSFER_TEMPLATE_ID,
		template_code: HTKT_TRANSFER_TEMPLATE_CODE
	};
}

function htktBuildPaymentTemplateRows(sourceRows, paymentKind) {
	var rows = [];
	var totalRaw = 0;

	for (var i = 0; i < sourceRows.length; i++) {
		var source = sourceRows[i];
		var isCash = HTKT_COMMON.htktIsCashPaymentMethod(source.payment_method);
		var isTransfer = HTKT_COMMON.htktIsTransferPaymentMethod(source.payment_method);

		if (
				(paymentKind === "cash" && !isCash) ||
				(paymentKind === "transfer" && !isTransfer)
		) {
			continue;
		}

		var amountRaw = Number(source.amount_raw || 0);

		rows.push({
			stt: rows.length + 1,
			beneficiary_name: source.beneficiary_name,
			beneficiary_account: source.beneficiary_account,
			beneficiary_bank_name: source.beneficiary_bank_name,
			beneficiary_bank: source.beneficiary_bank_name || source.beneficiary_bank,
			bank_name: source.beneficiary_bank_name,
			bank: source.beneficiary_bank_name,
			ten_ngan_hang: source.beneficiary_bank_name,
			ngan_hang: source.beneficiary_bank_name,
			transaction_des: source.transaction_des,
			identity_number: source.identity_number,
			issued_date: HTKT_COMMON.htktFormatDateShort(source.issued_date_raw),
			issued_place: source.issued_place,
			phone: source.phone,
			amount: HTKT_COMMON.htktFormatMoney(amountRaw)
		});

		totalRaw += amountRaw;
	}

	return {
		rows: rows,
		totalRaw: totalRaw,
		cashCheckbox: paymentKind === "cash" ? "☒" : "☐",
		transferCheckbox: paymentKind === "transfer" ? "☒" : "☐"
	};
}

function htktGetPaymentEntrySourceRows(paymentId) {
	var result = [];
	var entryFile = null;
	var rc = null;

	try {
		entryFile = HTKT_COMMON.newReadOnlyFile(
				HTKT_TABLE.PAYMENT_ENTRY
		);
		rc = entryFile.doSelect(
				'payment.id="' +
				HTKT_COMMON.escapeQueryValue(paymentId) +
				'"'
		);

		while (rc === RC_SUCCESS) {
			result.push({
				id: HTKT_COMMON.readString(entryFile, ["id"]),
				type: HTKT_COMMON.readString(entryFile, ["type"]),
				entry_type: HTKT_COMMON.readString(entryFile, ["entry.type"]),
				account_type: HTKT_COMMON.readString(entryFile, ["account.type"]),
				account_number: HTKT_COMMON.readString(
						entryFile,
						["account.number"]
				),
				account_name: HTKT_COMMON.readString(entryFile, ["account.name"]),
				description: HTKT_COMMON.readString(entryFile, ["description"]),
				amount_raw: HTKT_COMMON.readNumber(entryFile, ["amount"]),
				vendor_id: HTKT_COMMON.readString(entryFile, ["vendor.id"]),
				order: HTKT_COMMON.readNumber(entryFile, ["order"]),
				accounting_request_id: HTKT_COMMON.readString(
						entryFile,
						["accounting.request.id"]
				)
			});

			rc = entryFile.getNext();
		}
	} catch (eEntryRows) {
		result = [];
	}

	HTKT_COMMON.closeFile(entryFile);

	result.sort(function (left, right) {
		var orderDifference =
				Number(left.order || 0) - Number(right.order || 0);

		if (orderDifference !== 0) {
			return orderDifference;
		}

		return HTKT_COMMON.toString(left.id) < HTKT_COMMON.toString(right.id)
				? -1
				: 1;
	});

	return result;
}

function htktGetAccountSide(accountType) {
	var normalized = HTKT_COMMON.htktNormalizePaymentMethod(accountType);

	if (normalized === "NO" || normalized === "DEBIT") {
		return "debit";
	}

	if (
			normalized === "TAISAN" ||
			normalized === "CO" ||
			normalized === "CREDIT" ||
			normalized === "ASSET"
	) {
		return "credit";
	}

	return "";
}

function htktGetGlGroupInfo(paymentId, entry) {
	var prefix = HTKT_COMMON.trim(paymentId) + ".GL.";
	var entryId = HTKT_COMMON.trim(entry.id);
	var suffix = entryId.indexOf(prefix) === 0
			? entryId.substring(prefix.length)
			: "";
	var parts = suffix ? suffix.split(".") : [];

	if (parts.length >= 2 && /^\d+$/.test(parts[0])) {
		return {
			key: "ID:" + parts[0],
			order: Number(parts[0])
		};
	}

	if (parts.length === 1 && /^\d+$/.test(parts[0])) {
		return { key: "ID:1", order: 1 };
	}

	if (entry.accounting_request_id) {
		return {
			key: "REQUEST:" + entry.accounting_request_id,
			order: 999999
		};
	}

	return {
		key: "ROW:" + entryId,
		order: 999999
	};
}

function htktBuildSupplementalEntryRows(paymentId, entryRows) {
	var groupsByKey = {};
	var groups = [];

	for (var i = 0; i < entryRows.length; i++) {
		var entry = entryRows[i];
		var normalizedType = HTKT_COMMON.htktNormalizePaymentMethod(entry.type);

		if (normalizedType !== HTKT_ENTRY_TYPE_GL) {
			continue;
		}

		var groupInfo = htktGetGlGroupInfo(paymentId, entry);
		var group = groupsByKey[groupInfo.key];

		if (!group) {
			group = {
				key: groupInfo.key,
				order: groupInfo.order,
				descriptions: [],
				descriptionSet: {},
				totalDebitRaw: 0
			};
			groupsByKey[groupInfo.key] = group;
			groups.push(group);
		}

		if (
				entry.description &&
				!group.descriptionSet[entry.description]
		) {
			group.descriptionSet[entry.description] = true;
			group.descriptions.push(entry.description);
		}

		if (htktGetAccountSide(entry.account_type) === "debit") {
			group.totalDebitRaw += Number(entry.amount_raw || 0);
		}
	}

	groups.sort(function (left, right) {
		return left.order - right.order;
	});

	var result = [];
	for (var groupIndex = 0; groupIndex < groups.length; groupIndex++) {
		result.push({
			stt: groupIndex + 1,
			description: groups[groupIndex].descriptions.join("\n"),
			amount: HTKT_COMMON.htktFormatMoney(groups[groupIndex].totalDebitRaw),
			note: ""
		});
	}

	return result;
}

function htktGetAccountingBankName(entry, vendorById) {
	var entryType = htktGetAccountingEntryType(entry.entry_type);
	var vendor = vendorById[entry.vendor_id];

	if (entryType === HTKT_ACCOUNTING_ENTRY_PREPAYMENT) {
		return "VietinBank";
	}

	if (entryType === HTKT_ACCOUNTING_ENTRY_TAX) {
		return "";
	}

	if (entryType === HTKT_ACCOUNTING_ENTRY_CUSTOMER && vendor) {
		if (HTKT_COMMON.htktIsCashPaymentMethod(vendor.payment_method)) {
			return "VietinBank";
		}

		return vendor.beneficiary_bank_name;
	}

	return "";
}

function htktGetAccountingEntryType(value) {
	var entryType = HTKT_COMMON.trim(value).toUpperCase();

	if (
			entryType === HTKT_ACCOUNTING_ENTRY_COST ||
			entryType === HTKT_ACCOUNTING_ENTRY_PREPAYMENT ||
			entryType === HTKT_ACCOUNTING_ENTRY_TAX ||
			entryType === HTKT_ACCOUNTING_ENTRY_PAYABLE ||
			entryType === HTKT_ACCOUNTING_ENTRY_CUSTOMER
	) {
		return entryType;
	}

	return "";
}

function htktGetAccountingEntryOrder(entryType) {
	if (entryType === HTKT_ACCOUNTING_ENTRY_COST) {
		return 1;
	}

	if (entryType === HTKT_ACCOUNTING_ENTRY_TAX) {
		return 2;
	}

	if (entryType === HTKT_ACCOUNTING_ENTRY_PREPAYMENT) {
		return 3;
	}

	if (entryType === HTKT_ACCOUNTING_ENTRY_PAYABLE) {
		return 4;
	}

	if (entryType === HTKT_ACCOUNTING_ENTRY_CUSTOMER) {
		return 5;
	}

	return 999;
}

function htktGetAccountingDefaultSide(entryType) {
	if (
			entryType === HTKT_ACCOUNTING_ENTRY_COST ||
			entryType === HTKT_ACCOUNTING_ENTRY_TAX
	) {
		return "debit";
	}

	if (
			entryType === HTKT_ACCOUNTING_ENTRY_PREPAYMENT ||
			entryType === HTKT_ACCOUNTING_ENTRY_CUSTOMER
	) {
		return "credit";
	}

	return "";
}

function htktBuildAccountingRows(entryRows, vendorSourceRows) {
	var vendorById = {};
	var rows = [];
	var totalDebitRaw = 0;
	var totalCreditRaw = 0;
	var accountingEntries = [];

	for (var vendorIndex = 0;
	     vendorIndex < vendorSourceRows.length;
	     vendorIndex++
	) {
		vendorById[vendorSourceRows[vendorIndex].vendor_id] =
				vendorSourceRows[vendorIndex];
	}

	for (var i = 0; i < entryRows.length; i++) {
		var entry = entryRows[i];
		var entryType = htktGetAccountingEntryType(entry.entry_type);

		/* Chỉ các entry.type nghiệp vụ này thuộc bảng hạch toán chính. */
		if (!entryType) {
			continue;
		}

		accountingEntries.push({
			entry: entry,
			entryType: entryType,
			displayOrder: htktGetAccountingEntryOrder(entryType)
		});
	}

	/*
	 * Một nhóm bút toán được hiển thị theo đúng layout mẫu:
	 * Chi phí -> Thuế (nếu có) -> Tạm ứng (nếu có) ->
	 * Phải trả (nếu có) -> Chuyển tiền/Khách hàng.
	 * `order` của PaymentEntry vẫn giữ thứ tự giữa các dòng cùng loại.
	 */
	accountingEntries.sort(function (left, right) {
		if (left.displayOrder !== right.displayOrder) {
			return left.displayOrder - right.displayOrder;
		}

		return Number(left.entry.order || 0) - Number(right.entry.order || 0);
	});

	for (var entryIndex = 0;
	     entryIndex < accountingEntries.length;
	     entryIndex++
	) {
		var accountingEntry = accountingEntries[entryIndex];
		var sourceEntry = accountingEntry.entry;
		var sourceEntryType = accountingEntry.entryType;
		var amountRaw = Number(sourceEntry.amount_raw || 0);
		var accountSide = htktGetAccountSide(sourceEntry.account_type) ||
				htktGetAccountingDefaultSide(sourceEntryType);
		var debitAmount = "";
		var creditAmount = "";

		if (accountSide === "debit") {
			totalDebitRaw += amountRaw;
			debitAmount = HTKT_COMMON.htktFormatMoney(amountRaw);
		} else if (accountSide === "credit") {
			totalCreditRaw += amountRaw;
			creditAmount = HTKT_COMMON.htktFormatMoney(amountRaw);
		}

		rows.push({
			/* Dòng CUSTOMER là dòng chuyển tiền, không đánh STT trong mẫu. */
			stt: sourceEntryType === HTKT_ACCOUNTING_ENTRY_CUSTOMER
					? ""
					: rows.length + 1,
			entry_type: sourceEntryType,
			account_number: sourceEntry.account_number,
			account_name: sourceEntry.account_name,
			bank_name: htktGetAccountingBankName(sourceEntry, vendorById),
			description: sourceEntry.description,
			debit_amount: debitAmount,
			credit_amount: creditAmount
		});
	}

	return {
		rows: rows,
		totalDebitRaw: totalDebitRaw,
		totalCreditRaw: totalCreditRaw
	};
}

function htktGetPrepaymentCreditAccountNumbers(entryRows) {
	var accountNumbers = [];
	var accountNumberSet = {};

	for (var i = 0; i < entryRows.length; i++) {
		var entry = entryRows[i];
		var entryType = htktGetAccountingEntryType(entry.entry_type);
		var accountNumber = HTKT_COMMON.trim(entry.account_number);

		if (
				entryType !== HTKT_ACCOUNTING_ENTRY_PREPAYMENT ||
				htktGetAccountSide(entry.account_type) !== "credit" ||
				!accountNumber ||
				accountNumberSet[accountNumber]
		) {
			continue;
		}

		accountNumberSet[accountNumber] = true;
		accountNumbers.push(accountNumber);
	}

	return accountNumbers.join(", ");
}

function htktGetPrepaymentCreditAccountNames(entryRows) {
	var accountNames = [];
	var accountNameSet = {};

	for (var i = 0; i < entryRows.length; i++) {
		var entry = entryRows[i];
		var entryType = htktGetAccountingEntryType(entry.entry_type);
		var accountName = HTKT_COMMON.trim(entry.account_name);

		if (
				entryType !== HTKT_ACCOUNTING_ENTRY_PREPAYMENT ||
				htktGetAccountSide(entry.account_type) !== "credit" ||
				!accountName ||
				accountNameSet[accountName]
		) {
			continue;
		}

		accountNameSet[accountName] = true;
		accountNames.push(accountName);
	}

	return accountNames.join(", ");
}

function htktGetPrepaymentCreditBankNames(entryRows, vendorSourceRows) {
	var bankNames = [];
	var bankNameSet = {};
	var vendorById = {};

	for (var vendorIndex = 0;
	     vendorIndex < vendorSourceRows.length;
	     vendorIndex++
	) {
		vendorById[vendorSourceRows[vendorIndex].vendor_id] =
				vendorSourceRows[vendorIndex];
	}

	for (var i = 0; i < entryRows.length; i++) {
		var entry = entryRows[i];
		var entryType = htktGetAccountingEntryType(entry.entry_type);
		var accountNumber = HTKT_COMMON.trim(entry.account_number);

		if (
				entryType !== HTKT_ACCOUNTING_ENTRY_PREPAYMENT ||
				htktGetAccountSide(entry.account_type) !== "credit" ||
				!accountNumber
		) {
			continue;
		}

		var bankName = htktGetAccountingBankName(entry, vendorById);

		if (!bankName || bankNameSet[bankName]) {
			continue;
		}

		bankNameSet[bankName] = true;
		bankNames.push(bankName);
	}

	return bankNames.join(", ");
}

function htktBuildTemplateData(paymentId) {
	/* Cache chỉ dùng trong một lần dựng phiếu để không giữ dữ liệu danh mục cũ. */
	HTKT_VENDOR_INFO_CACHE = {};
	HTKT_BANK_NAME_CACHE = {};

	var paymentFile = HTKT_COMMON.getPaymentRecord(paymentId);

	if (!paymentFile) {
		return {
			success: false,
			message:
					"Không tìm thấy phiếu " + paymentId +
					" trong esdHTKTpayment."
		};
	}

	var createdAtValue = HTKT_COMMON.readValue(paymentFile, ["created.at"]);
	var createdByUsername = HTKT_COMMON.readString(
			paymentFile,
			["created.by"]
	);
	var departmentId = HTKT_COMMON.readString(paymentFile, ["department"]);
	var description = HTKT_COMMON.readString(paymentFile, ["description"]);
	var currency = HTKT_COMMON.readString(paymentFile, ["currency"]) || "VND";
	var contractId = HTKT_COMMON.readString(paymentFile, ["contract.id"]);
	var vendorSourceRows = htktGetPaymentVendorSourceRows(
			paymentId,
			currency
	);
	var prepaymentTotals = htktBuildPrepaymentTemplateTotals(
			paymentId,
			contractId,
			vendorSourceRows
	);
	var taxByVendor = htktGetDeductibleTaxByVendor(
			paymentId,
			vendorSourceRows
	);
	var vendorData = htktBuildVendorTemplateRows(
			vendorSourceRows,
			taxByVendor
	);
	var paymentTemplate = htktResolvePaymentTemplate(vendorSourceRows);

	if (!paymentTemplate.success) {
		HTKT_COMMON.closeFile(paymentFile);
		return paymentTemplate;
	}

	var paymentData = htktBuildPaymentTemplateRows(
			vendorSourceRows,
			paymentTemplate.kind
	);
	var entryRows = htktGetPaymentEntrySourceRows(paymentId);
	var supplementalEntryRows = htktBuildSupplementalEntryRows(
			paymentId,
			entryRows
	);
	var accountingData = htktBuildAccountingRows(
			entryRows,
			vendorSourceRows
	);
	var refundAmountRaw = Number(prepaymentTotals.totalRefundRaw || 0);
	var hasRefundAmount = refundAmountRaw > 0;
	var amountRaw = vendorData.totalAmountRaw;
	var lineTotalRaw = vendorData.totalLineTotalRaw || 0;
	var amountWords = HTKT_COMMON.htktAmountToVietnameseWords(amountRaw, currency);
	var prepaymentCreditAccountNumbers = htktGetPrepaymentCreditAccountNumbers(
			entryRows
	);
	var prepaymentCreditAccountNames = htktGetPrepaymentCreditAccountNames(
			entryRows
	);
	var prepaymentCreditBankNames = htktGetPrepaymentCreditBankNames(
			entryRows,
			vendorSourceRows
	);
	var data = {
		unit_name: HTKT_COMMON.htktGetCreatorUnitName(createdByUsername),
		created_at: HTKT_COMMON.htktFormatDateLong(createdAtValue),
		id: paymentId,
		recipient: HTKT_PAYMENT_RECIPIENT,
		created_by: HTKT_COMMON.htktGetContactDisplayName(createdByUsername),
		department_name: HTKT_COMMON.htktGetOrgUnitName(departmentId),
		description: description,
		amount_raw: amountRaw,
		total_amount: HTKT_COMMON.htktFormatMoney(amountRaw),
		currency: currency,
		calc_amount_words: amountWords,

		vendor_rows: vendorData.rows,
		calc_total_amount_before_tax: HTKT_COMMON.htktFormatMoney(
				vendorData.totalAmountBeforeTaxRaw
		),
		calc_total_tax_amount: HTKT_COMMON.htktFormatMoney(vendorData.totalTaxRaw),
		calc_total_vendor_amount: HTKT_COMMON.htktFormatMoney(
				vendorData.totalAmountRaw
		),
		calc_total_amount_vendors: HTKT_COMMON.htktFormatMoney(
				vendorData.totalLineTotalRaw || 0
		),
		total_line_total_raw: vendorData.totalLineTotalRaw || 0,

		/* (20), (21), (24) - Tab thông tin công nợ / chi tiết NCC. */
		calc_total_advance_amount: HTKT_COMMON.htktFormatMoney(
				prepaymentTotals.totalAdvanceRaw
		),
		calc_total_refund_amount: HTKT_COMMON.htktFormatMoney(
				prepaymentTotals.totalRefundRaw
		),
		calc_total_remaining_amount: HTKT_COMMON.htktFormatMoney(
				prepaymentTotals.totalRemainingRaw
		),

		/*
		 * (59): số hoàn ứng lần này; để trống nếu không phát sinh hoàn ứng.
		 * (60): số tiền (59) bằng chữ.
		 * (62): các TK ghi Có có entry.type = PREPAYMENT.
		 */
		refund_checkbox: hasRefundAmount ? "☒" : "☐",
		refund_amount_to_submit: hasRefundAmount
				? HTKT_COMMON.htktFormatMoney(refundAmountRaw)
				: "",
		refund_amount_to_submit_words: hasRefundAmount
				? HTKT_COMMON.htktAmountToVietnameseWords(refundAmountRaw, currency)
				: "",

		/*
		 * Mapping 3 trường hoàn tạm ứng khớp vị trí placeholder trên template Doc Service:
		 * 1. Số TK ghi Có: accountNumber (ví dụ 126150610)
		 * 2. Tên TK: accountName (ví dụ Tạm ứng cho nhà cung cấp hàng hóa, dịch vụ)
		 * 3. Tại Ngân hàng: bankName (ví dụ VietinBank)
		 */
		prepayment_credit_account_numbers: prepaymentCreditAccountNumbers,
		prepayment_credit_account_number: prepaymentCreditAccountNumbers,
		prepayment_credit_account_names: prepaymentCreditAccountNumbers,
		prepayment_credit_account_name: prepaymentCreditAccountNumbers,

		prepayment_credit_bank_accounts: prepaymentCreditAccountNames,
		prepayment_credit_bank_account: prepaymentCreditAccountNames,

		prepayment_credit_bank_names: prepaymentCreditBankNames,
		prepayment_credit_bank_name: prepaymentCreditBankNames,
		prepayment_credit_banks: prepaymentCreditBankNames,
		prepayment_credit_bank: prepaymentCreditBankNames,
		prepayment_bank_names: prepaymentCreditBankNames,
		prepayment_bank_name: prepaymentCreditBankNames,
		prepayment_bank: prepaymentCreditBankNames,
		prepayment_banks: prepaymentCreditBankNames,
		refund_bank_name: prepaymentCreditBankNames,
		refund_bank_names: prepaymentCreditBankNames,
		refund_bank: prepaymentCreditBankNames,
		refund_banks: prepaymentCreditBankNames,
		credit_bank_name: prepaymentCreditBankNames,
		credit_bank_names: prepaymentCreditBankNames,
		credit_bank: prepaymentCreditBankNames,
		credit_banks: prepaymentCreditBankNames,
		credit_bank_account: prepaymentCreditBankNames,
		credit_bank_accounts: prepaymentCreditBankNames,
		bank_name: prepaymentCreditBankNames,
		bank_names: prepaymentCreditBankNames,
		bank: prepaymentCreditBankNames,
		banks: prepaymentCreditBankNames,
		tai_ngan_hang: prepaymentCreditBankNames,
		ngan_hang: prepaymentCreditBankNames,
		ten_ngan_hang: prepaymentCreditBankNames,
		at_bank: prepaymentCreditBankNames,
		at_bank_name: prepaymentCreditBankNames,
		prepayment_credit_at_bank: prepaymentCreditBankNames,
		prepayment_credit_at_bank_name: prepaymentCreditBankNames,
		prepayment_credit_account_bank: prepaymentCreditBankNames,
		prepayment_credit_account_bank_name: prepaymentCreditBankNames,
		prepayment_credit_account_bank_names: prepaymentCreditBankNames,
		prepayment_credit_account_banks: prepaymentCreditBankNames,
		prepayment_credit_account_bank_account: prepaymentCreditBankNames,
		prepayment_credit_account_bank_accounts: prepaymentCreditBankNames,
		refund_at_bank: prepaymentCreditBankNames,
		refund_at_bank_name: prepaymentCreditBankNames,
		prepayment_at_bank: prepaymentCreditBankNames,
		prepayment_at_bank_name: prepaymentCreditBankNames,
		prepayment_credit_bank_branch: prepaymentCreditBankNames,
		credit_account_bank: prepaymentCreditBankNames,
		credit_account_bank_name: prepaymentCreditBankNames,

		supplemental_entry_rows: supplementalEntryRows,

		payment_method: paymentTemplate.payment_method,
		cash_checkbox: paymentData.cashCheckbox,
		transfer_checkbox: paymentData.transferCheckbox,
		cash_payment_rows: paymentTemplate.kind === "cash"
				? paymentData.rows
				: [],
		payment_rows: paymentTemplate.kind === "transfer"
				? paymentData.rows
				: [],
		calc_total_payment_amount: HTKT_COMMON.htktFormatMoney(paymentData.totalRaw),
		calc_total_cash_amount: paymentTemplate.kind === "cash"
				? HTKT_COMMON.htktFormatMoney(paymentData.totalRaw)
				: "",
		calc_total_transfer_amount: paymentTemplate.kind === "transfer"
				? HTKT_COMMON.htktFormatMoney(paymentData.totalRaw)
				: "",

		accounting_rows: accountingData.rows,
		calc_total_debit_amount: HTKT_COMMON.htktFormatMoney(
				accountingData.totalDebitRaw
		),
		calc_total_credit_amount: HTKT_COMMON.htktFormatMoney(
				accountingData.totalCreditRaw
		),

		/* Giữ nguyên vị trí chữ ký, chưa nhúng ảnh vào template. */
		user_approver_dmms: "",
		user_approver_kttc: "",
		blank_signature: "",
		user_approver_final: "",

		payment_id: paymentId,
		created_by_username: createdByUsername,
		template_code: paymentTemplate.template_code,
		output_file_name:
				HTKT_COMMON.sanitizeFileName(
						"Phieu-de-nghi-thanh-toan" + paymentId
				) + ".pdf"
	};

	HTKT_COMMON.closeFile(paymentFile);

	return {
		success: true,
		message: "",
		templateId: paymentTemplate.template_id,
		templateCode: paymentTemplate.template_code,
		data: data
	};
}


/* =============================================================================
 * 6. GỌI HPT ESD DOCUMENT SERVICE
 * ============================================================================= */

function htktHttpPost(url, body) {
	var safeUrl = HTKT_COMMON.toString(url);
	var safeBody = HTKT_COMMON.toString(body);
	var responseBody = "";
	// trưởng thêm: Document Service nhận payload JSON chứa templateId và data.
	var headers = [
		new Header("Content-Type", "application/json"),
		new Header("Accept", "application/json")
	];

	HTKT_COMMON.log("EFORM POST " + safeUrl);
	HTKT_COMMON.log("EFORM request body length = " + safeBody.length);

	try {
		responseBody = doHTTPRequest(
				"POST",
				safeUrl,
				headers,
				safeBody,
				HTKT_DOC_HTTP_TIMEOUT,
				HTKT_DOC_HTTP_TIMEOUT,
				HTKT_DOC_HTTP_TIMEOUT
		);

		return {
			ok: true,
			body: HTKT_COMMON.toString(responseBody),
			error: ""
		};
	} catch (eHttp) {
		return {
			ok: false,
			body: "",
			error: HTKT_COMMON.exceptionToString(eHttp)
		};
	}
}

function htktGeneratePdfBase64Response(templateId, templateData) {
	var payload = {
		templateId: templateId,
		data: templateData
	};

	var response = htktHttpPost(
			HTKT_DOC_SERVICE_BASE_URL + HTKT_DOC_GENERATE_PDF_BASE64_PATH,
			HTKT_COMMON.safeStringify(payload, "")
	);

	if (!response.ok || !response.body) {
		return {
			success: false,
			message: "Không gọi được Document Service. " + HTKT_COMMON.toString(response.error),
			data: ""
		};
	}

	var result = HTKT_COMMON.safeParseJson(response.body, null);



	if (!result) {
		return {
			success: false,
			message: "Document Service trả về JSON không hợp lệ.",
			data: ""
		};
	}

	var base64 = HTKT_COMMON.trim(result.data);

	if (!base64) {
		return {
			success: false,
			message: "Response không có trường data chứa PDF base64.",
			data: ""
		};
	}

	if (
			result.mimeType &&
			HTKT_COMMON.toLower(result.mimeType) !== "application/pdf"
	) {
		return {
			success: false,
			message: "Document Service trả về mimeType không phải PDF: " + HTKT_COMMON.toString(result.mimeType),
			data: ""
		};
	}

	if (
			result.encoding &&
			HTKT_COMMON.toLower(result.encoding) !== "base64"
	) {
		return {
			success: false,
			message: "Document Service trả về encoding không phải base64: " + HTKT_COMMON.toString(result.encoding),
			data: ""
		};
	}

	if (base64.length > HTKT_DOC_MAX_BASE64_LENGTH) {
		return {
			success: false,
			message: "PDF base64 vượt quá giới hạn " + HTKT_DOC_MAX_BASE64_LENGTH + " ký tự.",
			data: ""
		};
	}

	return {
		success: true,
		message: "",
		data: base64,
		mimeType: result.mimeType || "application/pdf",
		encoding: result.encoding || "base64",
		templateId: result.templateId || templateId
	};
}

function htktBuildPdfCacheKey(templateId, templateData) {
	var serialized = HTKT_COMMON.safeStringify(templateData || {}, "{}");
	var hash = 0;

	for (var i = 0; i < serialized.length; i++) {
		hash = ((hash << 5) - hash) + serialized.charCodeAt(i);
		hash = hash | 0;
	}

	return [templateId, serialized.length, hash].join("|");
}

function htktGetPdfBase64Cached(templateId, templateData) {
	var cacheKey = htktBuildPdfCacheKey(templateId, templateData);
	var oldCacheKey = HTKT_COMMON.trim(vars["$L.htkt.eform.cache.key"]);
	var oldBase64 = HTKT_COMMON.trim(vars["$L.htkt.eform.pdf.base64"]);

	if (oldCacheKey === cacheKey && oldBase64) {
		return {
			success: true,
			message: "",
			data: oldBase64,
			mimeType: "application/pdf",
			encoding: "base64",
			templateId: templateId,
			fromCache: true
		};
	}

	var generated = htktGeneratePdfBase64Response(templateId, templateData);

	if (generated.success) {
		vars["$L.htkt.eform.cache.key"] = cacheKey;
		vars["$L.htkt.eform.pdf.base64"] = generated.data;
	}

	return generated;
}


/* =============================================================================
 * 7. CONTEXT DÙNG CHO PREVIEW / NEXTJS
 * ============================================================================= */

function htktBuildPreviewContext(input) {
	input = input || {};
	var paymentId = HTKT_COMMON.getCurrentPaymentId();

	if (!paymentId) {
		return {
			success: false,
			message: "Không xác định được ID phiếu hiện tại."
		};
	}
	var mapped = htktBuildTemplateData(paymentId);




	if (!mapped.success) {
		return mapped;
	}

	var templateId = HTKT_COMMON.trim(mapped.templateId);
	if (!templateId) {
		return {
			success: false,
			message: "Chưa cấu hình templateId cho mẫu " + HTKT_COMMON.toString(mapped.templateCode) + "."
		};
	}

	/* Đồng bộ hành vi cache với EFROMPrepayment.generatePresentationPdf. */
	var useCache = HTKT_COMMON.readBoolean(
			input,
			["useCache", "use_cache"],
			true
	);
	var generated = useCache ?
			htktGetPdfBase64Cached(templateId, mapped.data) :
			htktGeneratePdfBase64Response(templateId, mapped.data);
	if (!generated.success) {
		return generated;
	}

	var fileName = mapped.data.output_file_name;

	return {
		success: true,
		message: "",
		paymentId: paymentId,
		templateId: templateId,
		templateCode: mapped.templateCode,
		templateData: mapped.data,
		pdfBase64: generated.data,
		mimeType: generated.mimeType || "application/pdf",
		encoding: generated.encoding || "base64",
		fileName: fileName,
		fromCache: generated.fromCache === true
	};
}




/* =============================================================================
 * 8. RENDER TRỰC TIẾP TRONG HTML VIEWER
 * ============================================================================= */

function RENDER() {
	var context = htktBuildPreviewContext({ useCache: true });
	if (!context.success) {
		return HTKT_COMMON.htktBuildErrorHtml("PDF Preview", context.message);
	}

	var base64PDF = HTKT_COMMON.htktEscapeForJavaScript(context.pdfBase64);


	return (
			"<div style='margin:0;padding:0;width:100%;height:100%;font-family:Arial,sans-serif;'>" +
			"<iframe id='htktPdfFrame' width='100%' height='100%' style='min-height:700px;border:none;background:#e5e7eb;'></iframe>" +
			"<script>" +
			"(function(){" +
			"var base64='" + base64PDF + "';" +
			"function toBytes(value){" +
			"var binary=atob(value);" +
			"var bytes=new Uint8Array(binary.length);" +
			"for(var i=0;i<binary.length;i++){bytes[i]=binary.charCodeAt(i);}" +
			"return bytes;" +
			"}" +
			"try{" +
			"var blob=new Blob([toBytes(base64)],{type:'application/pdf'});" +
			"var url=URL.createObjectURL(blob);" +
			"var frame=document.getElementById('htktPdfFrame');" +
			"frame.src=url+'#toolbar=0&navpanes=0&view=FitH';" +
			"window.addEventListener('beforeunload',function(){URL.revokeObjectURL(url);});" +
			"}catch(e){" +
			"document.body.innerHTML='<div style=\"padding:16px;color:red;font-family:Arial;\">Lỗi render PDF: '+e+'</div>';" +
			"}" +
			"})();" +
			"</script>" +
			"</div>"
	);
}