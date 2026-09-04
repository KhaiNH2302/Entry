var HTKT_COMMON = lib.ESD_HTKT_PAYMENT_COMMON;
var HTKT_TABLE = HTKT_COMMON.getTables();

var HTKT_DOC_SERVICE_BASE_URL = HTKT_COMMON.trim(lib.ESD_ENV_CONFIG.gendocUrl()).replace(/\/$/, "");
var HTKT_DOC_GENERATE_PDF_BASE64_PATH = "/api/generate/pdf/base64";
var HTKT_DOC_HTTP_TIMEOUT = 300;
var HTKT_DOC_MAX_BASE64_LENGTH = 5000000;


var HTKT_CASH_TEMPLATE_ID = "f25ef10b-cc9d-466c-9fd5-6b4708bf1a4a";
var HTKT_CASH_TEMPLATE_CODE = "HTKT-02-TTTM";
var HTKT_TRANSFER_TEMPLATE_ID = "26632b12-9e38-42d2-a8aa-75dce22de2d6";
var HTKT_TRANSFER_TEMPLATE_CODE = "HTKT-04-TTCK";

// var HTKT_CASH_TEMPLATE_ID = "c577c5e7-484f-401b-ad6e-a49186d64d57";
// var HTKT_CASH_TEMPLATE_CODE = "HTKT-02-TTTM";
// var HTKT_TRANSFER_TEMPLATE_ID = "c5985acb-3a69-49fc-b41c-7d572d3279ec";
// var HTKT_TRANSFER_TEMPLATE_CODE = "HTKT-04-TTCK__3_";
var HTKT_PAYMENT_RECIPIENT = "Lãnh đạo đơn vị";

function htktEscapeForJavaScript(value) {
	return HTKT_COMMON.toString(value)
			.replace(/\\/g, "\\\\")
			.replace(/'/g, "\\'")
			.replace(/\r/g, "")
			.replace(/\n/g, "");
}

function htktNormalizePaymentMethod(value) {
	return HTKT_COMMON.normalizeCode(value).replace(/_/g, "");
}

function htktIsCashPaymentMethod(value) {
	var normalized = htktNormalizePaymentMethod(value);
	return normalized === "TIENMAT" || normalized === "CASH";
}

function htktIsTransferPaymentMethod(value) {
	var normalized = htktNormalizePaymentMethod(value);
	return normalized === "CHUYENKHOAN" ||
			normalized === "BANKTRANSFER" ||
			normalized === "TRANSFER";
}

function htktFormatDateLong(value) {
	var dateValue = HTKT_COMMON.toDate(value);
	if (!dateValue) {
		return "";
	}

	return "Ngày " + dateValue.getDate() +
			" tháng " + (dateValue.getMonth() + 1) +
			" năm " + dateValue.getFullYear();
}

function htktPadDatePart(value) {
	var numberValue = Number(value || 0);
	return numberValue < 10 ? "0" + numberValue : String(numberValue);
}

function htktFormatDateShort(value) {
	var dateValue = HTKT_COMMON.toDate(value);
	if (!dateValue) {
		return "";
	}

	return htktPadDatePart(dateValue.getDate()) + "/" +
			htktPadDatePart(dateValue.getMonth() + 1) + "/" +
			dateValue.getFullYear();
}

function htktBuildErrorHtml(title, message) {
	return (
			"<div style='padding:20px;font-family:Arial,sans-serif;color:#b91c1c;'>" +
			"<div style='font-size:16px;font-weight:bold;margin-bottom:8px;'>" +
			HTKT_COMMON.escapeHtml(title || "Có lỗi xảy ra") +
			"</div>" +
			"<div>" +
			HTKT_COMMON.escapeHtml(message || "") +
			"</div>" +
			"</div>"
	);
}

function htktGetContactDisplayName(contactName) {
	var safeContactName = HTKT_COMMON.trim(contactName);

	if (!safeContactName) {
		return "";
	}

	var contactFile = HTKT_COMMON.selectOne(
			HTKT_TABLE.CONTACT,
			["contact.name"],
			safeContactName
	);
	if (!contactFile) {
		return safeContactName;
	}

	var displayName = HTKT_COMMON.readString(
			contactFile,
			["full.name", "contact.full.name", "contact.name"]
	);

	HTKT_COMMON.closeFile(contactFile);
	return displayName || safeContactName;
}

function htktGetOrgUnitName(unitId) {
	var safeUnitId = HTKT_COMMON.trim(unitId);
	var unitFile = null;
	var unitName = "";

	if (!safeUnitId) {
		return "";
	}

	unitFile = HTKT_COMMON.selectOne(
			HTKT_TABLE.ORG_UNIT,
			["unit.id"],
			safeUnitId
	);
	if (unitFile) {
		unitName = HTKT_COMMON.readString(unitFile, ["unit.name"]);
	}

	HTKT_COMMON.closeFile(unitFile);
	return unitName;
}

function htktGetCreatorUnitName(contactName) {
	var safeContactName = HTKT_COMMON.trim(contactName);
	var contactFile = null;
	var unitLv1Id = "";

	if (!safeContactName) {
		return "";
	}

	contactFile = HTKT_COMMON.selectOne(
			HTKT_TABLE.CONTACT,
			["contact.name"],
			safeContactName
	);

	if (contactFile) {
		unitLv1Id = HTKT_COMMON.readString(contactFile, ["lv1.id"]);
	}

	HTKT_COMMON.closeFile(contactFile);
	return htktGetOrgUnitName(unitLv1Id);
}

function htktReadThreeDigits(numberValue, readFull) {
	var digits = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];

	var hundreds = Math.floor(numberValue / 100);
	var tens = Math.floor((numberValue % 100) / 10);
	var units = numberValue % 10;
	var result = [];

	if (hundreds > 0 || readFull) {
		result.push(digits[hundreds] + " trăm");
	}

	if (tens > 1) {
		result.push(digits[tens] + " mươi");

		if (units === 1) {
			result.push("mốt");
		} else if (units === 4) {
			result.push("tư");
		} else if (units === 5) {
			result.push("lăm");
		} else if (units > 0) {
			result.push(digits[units]);
		}
	} else if (tens === 1) {
		result.push("mười");

		if (units === 5) {
			result.push("lăm");
		} else if (units > 0) {
			result.push(digits[units]);
		}
	} else if (units > 0) {
		if (hundreds > 0 || readFull) {
			result.push("lẻ");
		}
		result.push(digits[units]);
	}

	return result.join(" ");
}

function htktIntegerToVietnameseWords(numberValue) {
	var scales = ["", "nghìn", "triệu", "tỷ", "nghìn tỷ", "triệu tỷ"];
	var number = Math.floor(Math.abs(Number(numberValue || 0)));

	if (number === 0) {
		return "không";
	}

	var groups = [];
	while (number > 0) {
		groups.push(number % 1000);
		number = Math.floor(number / 1000);
	}

	var result = [];
	for (var i = groups.length - 1; i >= 0; i--) {
		var groupValue = groups[i];
		if (groupValue === 0) {
			continue;
		}

		var readFull = i < groups.length - 1 && groupValue < 100;
		var groupText = htktReadThreeDigits(groupValue, readFull);

		if (groupText) {
			result.push(groupText + (scales[i] ? " " + scales[i] : ""));
		}
	}

	return result.join(" ").replace(/\s+/g, " ");
}

function htktAmountToVietnameseWords(value, currency) {
	var amount = Number(value || 0);
	var signText = amount < 0 ? "âm " : "";
	var absolute = Math.abs(amount);
	var integerPart = Math.floor(absolute);
	var decimalText = HTKT_COMMON.toString(absolute).split(".")[1] || "";
	var result = signText + htktIntegerToVietnameseWords(integerPart);

	decimalText = decimalText.replace(/0+$/, "");

	if (decimalText) {
		var digitWords = ["không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"];
		var decimalWords = [];

		for (var i = 0; i < decimalText.length; i++) {
			decimalWords.push(digitWords[Number(decimalText.charAt(i))]);
		}

		result += " phẩy " + decimalWords.join(" ");
	}

	var safeCurrency = HTKT_COMMON.trim(currency).toUpperCase();

	if (safeCurrency === "VND") {
		result += " đồng";
	} else if (safeCurrency === "USD") {
		result += " đô la Mỹ";
	} else if (safeCurrency) {
		result += " " + safeCurrency;
	}

	result = result.replace(/\s+/g, " ");

	if (result) {
		result = result.charAt(0).toUpperCase() + result.substr(1);
	}

	return result;
}


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

function htktFormatMoney(value) {
	if (value === null || value === undefined || value === "") {
		return "0";
	}

	var amount = Number(value);
	if (isNaN(amount)) {
		return "0";
	}

	var isNegative = amount < 0;
	var parts = String(Math.abs(amount)).split(".");
	var integerPart = parts[0];
	var decimalPart = parts.length > 1 ? parts[1] : "";
	var result = "";

	while (integerPart.length > 3) {
		result = "." + integerPart.substr(integerPart.length - 3) + result;
		integerPart = integerPart.substr(0, integerPart.length - 3);
	}

	result = integerPart + result;

	if (decimalPart !== "" && Number(decimalPart) !== 0) {
		result += "," + decimalPart;
	}

	return (isNegative ? "-" : "") + result;
}

function htktGetVendorInfo(vendorId) {
	var safeVendorId = HTKT_COMMON.trim(vendorId);
	if (!safeVendorId) {
		return {id: "", name: "", tax_code: ""};
	}

	if (HTKT_VENDOR_INFO_CACHE[safeVendorId]) {
		return HTKT_VENDOR_INFO_CACHE[safeVendorId];
	}

	var strippedId = safeVendorId.replace(/^0+/, "");
	if (!strippedId) strippedId = "0";

	var queries = [
		"id=\"" + HTKT_COMMON.escapeQueryValue(safeVendorId) + "\"",
		"vendor.number=\"" + HTKT_COMMON.escapeQueryValue(safeVendorId) + "\""
	];

	if (strippedId !== safeVendorId) {
		queries.push("id=\"" + HTKT_COMMON.escapeQueryValue(strippedId) + "\"");
		queries.push("vendor.number=\"" + HTKT_COMMON.escapeQueryValue(strippedId) + "\"");
		if (!isNaN(Number(strippedId))) {
			queries.push("id=" + Number(strippedId));
		}
	}

	var foundName = "";
	var foundTaxCode = "";
	var f = null;

	try {
		f = new SCFile("esdHTKTvendor", SCFILE_READONLY);
		for (var q = 0; q < queries.length; q++) {
			var rc = f.doSelect(queries[q]);
			if (rc === RC_SUCCESS) {
				foundName = HTKT_COMMON.readString(f, ["vendor.name", "name"]);
				foundTaxCode = HTKT_COMMON.readString(f, ["vendor.number"]);
				break;
			}
		}
	} catch (eVendor) {
		HTKT_COMMON.log("Không query được esdHTKTvendor cho vendorId " + safeVendorId + ". " + HTKT_COMMON.exceptionToString(eVendor));
	} finally {
		if (f) {
			HTKT_COMMON.closeFile(f);
		}
	}

	var info = {
		id: safeVendorId,
		name: foundName,
		tax_code: foundTaxCode
	};

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
				"payment.id=\"" +
				HTKT_COMMON.escapeQueryValue(paymentId) +
				"\""
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
			var beneficiaryName = HTKT_COMMON.readString(
					vendorFile,
					["beneficiary.name"]
			);
			var vendorDisplayName = vendorInfo.name ||
					HTKT_COMMON.readString(vendorFile, ["vendor.name", "name", "vendor_name"]) ||
					vendorId;

			result.push({
				vendor_id: vendorId,
				vendor_name: vendorDisplayName,
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
				beneficiary_name: beneficiaryName,
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
	var normalizedSellerTaxCode = htktNormalizePaymentMethod(sellerTaxCode);

	if (normalizedSellerTaxCode) {
		for (var i = 0; i < sourceRows.length; i++) {
			if (
					htktNormalizePaymentMethod(sourceRows[i].vendor_tax_code) ===
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
				"payment.id=\"" +
				HTKT_COMMON.escapeQueryValue(paymentId) +
				"\""
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
			"AND pe.entry.type = \"PREPAYMENT\") " +
			"LEFT JOIN esdHTKTaccountingInformation aip " +
			"ON (pe.accounting.request.id = aip.request.id) " +
			"WHERE ai.sub.type = \"TAM_UNG\" " +
			"AND ai.contract.id = \"" +
			HTKT_COMMON.escapeQueryValue(safeContractId) + "\" " +
			"AND ai.vendor.id = \"" +
			HTKT_COMMON.escapeQueryValue(safeVendorId) + "\" " +
			"AND ai.status = \"COMPLETED\" " +
			"AND ai.type = \"AP\" " +
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
		var currentRefund = Number(row.current_refund_amount || 0);
		var baseRemaining = row.advance_amount - row.refunded_amount - row.other_pending_amount;

		// Nếu số tiền hoàn ứng lần này > 0 thì mới trừ vào số tiền còn lại
		if (currentRefund > 0) {
			row.remaining_amount = Math.max(baseRemaining - currentRefund, 0);
		} else {
			row.remaining_amount = Math.max(baseRemaining, 0);
		}
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
			 * (20), (24): Chỉ tính tổng các khoản tạm ứng CÓ PHÁT SINH HOÀN ỨNG
			 * ở ĐNTT lần này (current_refund_amount > 0).
			 */
			if (Number(ledger.current_refund_amount || 0) > 0) {
				totalAdvanceRaw += Number(ledger.advance_amount || 0);
				totalRemainingRaw += Number(ledger.remaining_amount || 0);
			}
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

		var finalVendorName = source.vendor_name || source.vendor_id;

		rows.push({
			stt: i + 1,                                        // {stt}    : STT dòng NCC
			vendor: finalVendorName,                             // {vendor} : Tên Nhà cung cấp (rút gọn từ vendor_name)
			vendor_name: finalVendorName,                        // Alias cũ tương thích
			pretax: htktFormatMoney(amountBeforeTaxRaw),         // {pretax} : Tiền chưa gồm VAT (rút gọn từ amount_before_tax)
			pre_tax: htktFormatMoney(amountBeforeTaxRaw),        // Alias tương thích
			amount_before_tax: htktFormatMoney(amountBeforeTaxRaw), // Alias cũ tương thích
			vat: htktFormatMoney(taxRaw),                        // {vat}    : Tiền thuế VAT (rút gọn từ tax_amount)
			tax_amount: htktFormatMoney(taxRaw),                 // Alias cũ tương thích
			total: htktFormatMoney(lineTotalRaw),                // {total}  : Tổng tiền theo NCC gồm VAT (rút gọn từ line_total)
			line_total: htktFormatMoney(lineTotalRaw),           // Alias cũ tương thích
			currency: source.currency || "",
			note: ""                                             // {note}   : Ghi chú
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

		if (htktIsCashPaymentMethod(rawMethod)) {
			hasCash = true;
		} else if (htktIsTransferPaymentMethod(rawMethod)) {
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
			message: "Phiếu chưa có thông tin của Nhà cung cấp."
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
		var isCash = htktIsCashPaymentMethod(source.payment_method);
		var isTransfer = htktIsTransferPaymentMethod(source.payment_method);

		if (
				(paymentKind === "cash" && !isCash) ||
				(paymentKind === "transfer" && !isTransfer)
		) {
			continue;
		}

		var amountRaw = Number(source.amount_raw || 0);

		rows.push({
			stt: rows.length + 1,                                        // {stt}      : STT dòng chi tiết
			name: source.beneficiary_name,                               // {name}     : Người / Đơn vị thụ hưởng (rút gọn từ beneficiary_name)
			beneficiary_name: source.beneficiary_name,                   // Alias cũ tương thích
			acc: source.beneficiary_account,                             // {acc}      : Số tài khoản thụ hưởng (rút gọn từ beneficiary_account)
			account_no: source.beneficiary_account,                      // Alias tương thích
			beneficiary_account: source.beneficiary_account,              // Alias cũ tương thích
			bank: source.beneficiary_bank_name,                          // {bank}     : Ngân hàng thụ hưởng (rút gọn từ beneficiary_bank_name)
			bank_name: source.beneficiary_bank_name,                     // Alias tương thích
			beneficiary_bank: source.beneficiary_bank_name || source.beneficiary_bank,
			beneficiary_bank_name: source.beneficiary_bank_name,         // Alias cũ tương thích
			des: source.transaction_des,                                 // {des}      : Nội dung chuyển khoản (rút gọn từ transaction_des)
			trans_des: source.transaction_des,                            // Alias tương thích
			transaction_des: source.transaction_des,                      // Alias cũ tương thích
			id_no: source.identity_number,                               // {id_no}    : Số CCCD/CMND/Hộ chiếu (rút gọn từ identity_number)
			id_card: source.identity_number,                             // Alias tương thích
			identity_number: source.identity_number,                      // Alias cũ tương thích
			id_date: htktFormatDateShort(source.issued_date_raw),         // {id_date}  : Ngày cấp giấy tờ (rút gọn từ issued_date)
			issued_date: htktFormatDateShort(source.issued_date_raw),     // Alias cũ tương thích
			id_place: source.issued_place,                               // {id_place} : Nơi cấp giấy tờ (rút gọn từ issued_place)
			issued_place: source.issued_place,                           // Alias cũ tương thích
			phone: source.phone,                                         // {phone}    : Số điện thoại người nhận
			amount: htktFormatMoney(amountRaw)                           // {amount}   : Số tiền chi tiết
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
				"payment.id=\"" +
				HTKT_COMMON.escapeQueryValue(paymentId) +
				"\""
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
	var normalized = htktNormalizePaymentMethod(accountType);

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
		return {key: "ID:1", order: 1};
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
		var normalizedType = htktNormalizePaymentMethod(entry.type);

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
			stt: groupIndex + 1,                                        // {stt}    : STT nghĩa vụ thanh toán khác
			des: groups[groupIndex].descriptions.join("\n"),             // {des}    : Nội dung chi tiết nghĩa vụ (rút gọn từ description)
			description: groups[groupIndex].descriptions.join("\n"),     // Alias cũ tương thích
			amount: htktFormatMoney(groups[groupIndex].totalDebitRaw),   // {amount} : Số tiền nghĩa vụ
			note: ""                                                     // {note}   : Ghi chú nghĩa vụ
		});
	}

	return result;
}

function htktGetAccountingBankName(entry, vendorById) {
	var entryType = htktGetAccountingEntryType(entry.entry_type);
	var vendor = (vendorById && entry.vendor_id) ? vendorById[entry.vendor_id] : null;

	/* Dòng bút toán Khách Hàng - ghi có */
	if (entryType === HTKT_ACCOUNTING_ENTRY_CUSTOMER) {
		if (vendor) {
			if (htktIsCashPaymentMethod(vendor.payment_method)) {
				return "VietinBank";
			}

			if (vendor.beneficiary_bank_name) {
				return vendor.beneficiary_bank_name;
			}
		}

		return "VietinBank";
	}

	/* Tất cả các loại tài khoản khác đều để mặc định là VietinBank */
	return "VietinBank";
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
			debitAmount = htktFormatMoney(amountRaw);
		} else if (accountSide === "credit") {
			totalCreditRaw += amountRaw;
			creditAmount = htktFormatMoney(amountRaw);
		}

		rows.push({
			/* Dòng CUSTOMER là dòng chuyển tiền, không đánh STT trong mẫu. */
			stt: sourceEntryType === HTKT_ACCOUNTING_ENTRY_CUSTOMER
					? ""
					: rows.length + 1,                                       // {stt}      : STT bút toán hạch toán
			entry_type: sourceEntryType,
			acc_no: sourceEntry.account_number,                            // {acc_no}   : Số tài khoản hạch toán (rút gọn từ account_number)
			account_number: sourceEntry.account_number,                    // Alias cũ tương thích
			acc_name: sourceEntry.account_name,                            // {acc_name} : Tên tài khoản hạch toán (rút gọn từ account_name)
			account_name: sourceEntry.account_name,                        // Alias cũ tương thích
			bank: htktGetAccountingBankName(sourceEntry, vendorById),      // {bank}     : Ngân hàng hạch toán (rút gọn từ bank_name)
			bank_name: htktGetAccountingBankName(sourceEntry, vendorById), // Alias tương thích
			des: sourceEntry.description,                                  // {des}      : Nội dung hạch toán (rút gọn từ description)
			description: sourceEntry.description,                          // Alias cũ tương thích
			debit: debitAmount,                                            // {debit}    : Số tiền ghi Nợ (rút gọn từ debit_amount)
			debit_amount: debitAmount,                                     // Alias cũ tương thích
			credit: creditAmount,                                          // {credit}   : Số tiền ghi Có (rút gọn từ credit_amount)
			credit_amount: creditAmount                                    // Alias cũ tương thích
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
	var hasPaymentAmount = Number(amountRaw || 0) > 0;
	var lineTotalRaw = vendorData.totalLineTotalRaw || 0;
	var amountWords = htktAmountToVietnameseWords(amountRaw, currency);
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
		/* =========================================================================
		 * 1. THÔNG TIN CHUNG PHIẾU ĐỀ NGHỊ (Header & Master Data)
		 * ========================================================================= */
		unit: htktGetCreatorUnitName(createdByUsername),                        // {unit}     : Tên đơn vị người tạo (VD: TRUNG TÂM CNTT)
		unit_name: htktGetCreatorUnitName(createdByUsername),                   // Alias cũ tương thích
		date: htktFormatDateLong(createdAtValue),                                // {date}     : Ngày lập phiếu (Ngày... tháng... năm...)
		created_at: htktFormatDateLong(createdAtValue),                          // Alias cũ tương thích
		id: paymentId,                                                          // {id}       : Mã giao dịch / Mã phiếu ĐNTT
		recipient: HTKT_PAYMENT_RECIPIENT,                                     // {recipient}: Kính gửi (Lãnh đạo đơn vị)
		user: htktGetContactDisplayName(createdByUsername),                     // {user}     : Họ tên người đề nghị (rút gọn từ created_by)
		created_by: htktGetContactDisplayName(createdByUsername),                // Alias cũ tương thích
		dept: htktGetOrgUnitName(departmentId),                                 // {dept}     : Tên Phòng/ban người đề nghị (rút gọn từ department_name)
		dept_name: htktGetOrgUnitName(departmentId),                           // Alias tương thích
		department_name: htktGetOrgUnitName(departmentId),                     // Alias cũ tương thích
		des: description,                                                       // {des}      : Nội dung thanh toán (rút gọn từ description)
		description: description,                                               // Alias cũ tương thích
		amount_raw: amountRaw,                                                  // Số tiền gốc chưa format
		amount: htktFormatMoney(amountRaw),                                     // {amount}   : Tổng số tiền đề nghị thanh toán (rút gọn từ total_amount)
		total_amount: htktFormatMoney(amountRaw),                              // Alias cũ tương thích
		amount_checkbox: hasPaymentAmount ? "☒" : "☐",                          // {amount_checkbox} : Checkbox Số tiền thanh toán (tích nếu amount > 0)
		payment_checkbox: hasPaymentAmount ? "☒" : "☐",                         // {payment_checkbox}: Alias tương thích
		pay_checkbox: hasPaymentAmount ? "☒" : "☐",                             // {pay_checkbox}    : Alias tương thích
		payment_amount_checkbox: hasPaymentAmount ? "☒" : "☐",                  // Alias tương thích
		total_amount_checkbox: hasPaymentAmount ? "☒" : "☐",                    // Alias tương thích
		cur: currency,                                                          // {cur}      : Loại tiền tệ (VND, USD, ...)
		currency: currency,                                                     // Alias cũ tương thích
		words: amountWords,                                                     // {words}    : Tổng số tiền đề nghị thanh toán bằng chữ (rút gọn từ calc_amount_words)
		amount_words: amountWords,                                             // Alias tương thích
		calc_amount_words: amountWords,                                         // Alias cũ tương thích

		/* =========================================================================
		 * 2. BẢNG CHI TIẾT THEO NHÀ CUNG CẤP (Vòng lặp: {#vendors})
		 * Các trường trong mỗi dòng: {stt}, {vendor}, {pretax}, {vat}, {total}, {note}
		 * ========================================================================= */
		vendors: vendorData.rows,                                               // {#vendors} : Danh sách chi tiết NCC (rút gọn từ vendor_rows)
		vendor_rows: vendorData.rows,                                           // Alias cũ tương thích
		sum_pretax: htktFormatMoney(vendorData.totalAmountBeforeTaxRaw),        // {sum_pretax} : Tổng tiền chưa gồm VAT
		total_pretax: htktFormatMoney(vendorData.totalAmountBeforeTaxRaw),     // Alias tương thích
		total_before_tax: htktFormatMoney(vendorData.totalAmountBeforeTaxRaw), // Alias tương thích
		calc_total_amount_before_tax: htktFormatMoney(vendorData.totalAmountBeforeTaxRaw),
		sum_vat: htktFormatMoney(vendorData.totalTaxRaw),                       // {sum_vat}    : Tổng tiền thuế VAT (rút gọn từ calc_total_tax_amount)
		total_tax: htktFormatMoney(vendorData.totalTaxRaw),                    // Alias tương thích
		calc_total_tax_amount: htktFormatMoney(vendorData.totalTaxRaw),        // Alias cũ tương thích
		sum_vendor: htktFormatMoney(vendorData.totalLineTotalRaw || 0),         // {sum_vendor} : Tổng cộng tiền thanh toán NCC (cột Tổng)
		total_vendor: htktFormatMoney(vendorData.totalLineTotalRaw || 0),      // Alias tương thích
		calc_total_amount_vendors: htktFormatMoney(vendorData.totalLineTotalRaw || 0), // Alias cũ tương thích
		calc_total_vendor_amount: htktFormatMoney(vendorData.totalAmountRaw),
		total_line_total_raw: vendorData.totalLineTotalRaw || 0,

		/* =========================================================================
		 * 3. THÔNG TIN CÔNG NỢ TẠM ỨNG & HOÀN ỨNG (Tab Công nợ theo Hợp đồng / NCC)
		 * ========================================================================= */
		advance: htktFormatMoney(prepaymentTotals.totalAdvanceRaw),             // {advance}   : Số tiền đã tạm ứng (rút gọn từ calc_total_advance_amount)
		total_advance: htktFormatMoney(prepaymentTotals.totalAdvanceRaw),        // Alias tương thích
		calc_total_advance_amount: htktFormatMoney(prepaymentTotals.totalAdvanceRaw), // Alias cũ tương thích
		refund: htktFormatMoney(prepaymentTotals.totalRefundRaw),               // {refund}    : Số tiền đề nghị hoàn tạm ứng (rút gọn từ calc_total_refund_amount)
		total_refund: htktFormatMoney(prepaymentTotals.totalRefundRaw),          // Alias tương thích
		calc_total_refund_amount: htktFormatMoney(prepaymentTotals.totalRefundRaw),   // Alias cũ tương thích
		remain: htktFormatMoney(prepaymentTotals.totalRemainingRaw),            // {remain}    : Số tiền tạm ứng còn lại sau hoàn ứng (rút gọn từ calc_total_remaining_amount)
		total_remain: htktFormatMoney(prepaymentTotals.totalRemainingRaw),       // Alias tương thích
		total_remaining: htktFormatMoney(prepaymentTotals.totalRemainingRaw),   // Alias tương thích
		calc_total_remaining_amount: htktFormatMoney(prepaymentTotals.totalRemainingRaw), // Alias cũ tương thích

		/* =========================================================================
		 * 4. THÔNG TIN HOÀN TẠM ỨNG PHẢI NỘP VÀ TÀI KHOẢN GHI CÓ HOÀN ỨNG
		 * ========================================================================= */
		refund_checkbox: hasRefundAmount ? "☒" : "☐",                           // Checkbox có phát sinh hoàn ứng hay không
		ref_checkbox: hasRefundAmount ? "☒" : "☐",                              // {ref_checkbox}    : Alias tương thích
		ref_amt_checkbox: hasRefundAmount ? "☒" : "☐",                          // {ref_amt_checkbox}: Alias tương thích
		refund_amount_checkbox: hasRefundAmount ? "☒" : "☐",                   // Alias tương thích
		ref_amt: hasRefundAmount ? htktFormatMoney(refundAmountRaw) : "",       // {ref_amt}   : Số tiền hoàn tạm ứng phải nộp (số)
		refund_submit: hasRefundAmount ? htktFormatMoney(refundAmountRaw) : "", // Alias tương thích
		refund_amount_to_submit: hasRefundAmount ? htktFormatMoney(refundAmountRaw) : "", // Alias cũ tương thích
		ref_words: hasRefundAmount ? htktAmountToVietnameseWords(refundAmountRaw, currency) : "", // {ref_words} : Tiền hoàn tạm ứng bằng chữ
		refund_words: hasRefundAmount ? htktAmountToVietnameseWords(refundAmountRaw, currency) : "", // Alias tương thích
		refund_submit_words: hasRefundAmount ? htktAmountToVietnameseWords(refundAmountRaw, currency) : "",
		refund_amount_to_submit_words: hasRefundAmount ? htktAmountToVietnameseWords(refundAmountRaw, currency) : "",

		// Thông tin tài khoản Có hoàn tạm ứng (siêu ngắn gọn):
		ref_acc: prepaymentCreditAccountNumbers,                               // {ref_acc}   : Số TK ghi Có (TK tạm ứng, VD: 126150610)
		prepay_no: prepaymentCreditAccountNumbers,                             // Alias tương thích
		ref_name: prepaymentCreditAccountNames,                                // {ref_name}  : Tên TK ghi Có (VD: Tạm ứng cho NCC...)
		prepay_name: prepaymentCreditAccountNames,                             // Alias tương thích
		ref_bank: prepaymentCreditBankNames,                                   // {ref_bank}  : Tại Ngân hàng (VD: VietinBank)
		prepay_bank: prepaymentCreditBankNames,                                 // Alias tương thích

		// Các alias tương thích ngược cũ
		prepayment_credit_account_numbers: prepaymentCreditAccountNumbers,
		prepayment_credit_account_number: prepaymentCreditAccountNumbers,
		prepayment_credit_account_names: prepaymentCreditAccountNumbers,
		prepayment_credit_account_name: prepaymentCreditAccountNumbers,
		prepayment_credit_bank_accounts: prepaymentCreditAccountNames,
		prepayment_credit_bank_account: prepaymentCreditAccountNames,
		prepayment_credit_bank_names: prepaymentCreditBankNames,
		prepayment_credit_bank_name: prepaymentCreditBankNames,
		bank_name: prepaymentCreditBankNames,

		/* =========================================================================
		 * 5. BẢNG CÁC NGHĨA VỤ THANH TOÁN KHÁC (Vòng lặp: {#supp})
		 * Các trường trong mỗi dòng: {stt}, {des}, {amount}, {note}
		 * ========================================================================= */
		supp: supplementalEntryRows,                                           // {#supp}     : Danh sách nghĩa vụ thanh toán khác (rút gọn từ supplemental_entry_rows)
		supp_rows: supplementalEntryRows,                                      // Alias tương thích
		supplemental_entry_rows: supplementalEntryRows,                         // Alias cũ tương thích

		/* =========================================================================
		 * 6. BẢNG CHI TIẾT THANH TOÁN (Tiền mặt: {#cash} / Chuyển khoản: {#trans})
		 * - Tiền mặt (02-TTTM): {stt}, {name}, {id_no}, {id_date}, {id_place}, {phone}, {amount}
		 * - Chuyển khoản (04-TTCK): {stt}, {name}, {acc}, {bank}, {des}, {amount}
		 * ========================================================================= */
		payment_method: paymentTemplate.payment_method,                         // Hình thức thanh toán: TIENMAT hoặc CHUYENKHOAN
		cash_checkbox: paymentData.cashCheckbox,                               // Checkbox Tiền mặt ☒/☐
		transfer_checkbox: paymentData.transferCheckbox,                       // Checkbox Chuyển khoản ☒/☐
		cash: paymentTemplate.kind === "cash" ? paymentData.rows : [],         // {#cash}     : Danh sách người nhận tiền mặt (02-TTTM)
		cash_rows: paymentTemplate.kind === "cash" ? paymentData.rows : [],    // Alias tương thích
		cash_payment_rows: paymentTemplate.kind === "cash" ? paymentData.rows : [], // Alias cũ tương thích
		trans: paymentTemplate.kind === "transfer" ? paymentData.rows : [],     // {#trans}    : Danh sách nhận chuyển khoản (04-TTCK)
		payment_rows: paymentTemplate.kind === "transfer" ? paymentData.rows : [],  // Alias tương thích
		transfer_rows: paymentTemplate.kind === "transfer" ? paymentData.rows : [], // Alias tương thích
		sum_trans: htktFormatMoney(paymentData.totalRaw),                      // {sum_trans} : Tổng tiền chuyển khoản (rút gọn từ calc_total_payment_amount)
		total_payment: htktFormatMoney(paymentData.totalRaw),                  // Alias tương thích
		calc_total_payment_amount: htktFormatMoney(paymentData.totalRaw),      // Alias cũ tương thích
		sum_cash: paymentTemplate.kind === "cash" ? htktFormatMoney(paymentData.totalRaw) : "", // {sum_cash}  : Tổng tiền mặt (rút gọn từ calc_total_cash_amount)
		total_cash: paymentTemplate.kind === "cash" ? htktFormatMoney(paymentData.totalRaw) : "", // Alias tương thích
		calc_total_cash_amount: paymentTemplate.kind === "cash" ? htktFormatMoney(paymentData.totalRaw) : "", // Alias cũ tương thích
		total_transfer: paymentTemplate.kind === "transfer" ? htktFormatMoney(paymentData.totalRaw) : "",
		calc_total_transfer_amount: paymentTemplate.kind === "transfer" ? htktFormatMoney(paymentData.totalRaw) : "",

		/* =========================================================================
		 * 7. BẢNG HẠCH TOÁN KẾ TOÁN (Vòng lặp: {#acc})
		 * Các trường trong mỗi dòng: {stt}, {acc_no}, {acc_name}, {bank}, {des}, {debit}, {credit}
		 * ========================================================================= */
		acc: accountingData.rows,                                              // {#acc}      : Danh sách các dòng bút toán hạch toán (rút gọn từ accounting_rows)
		acc_rows: accountingData.rows,                                         // Alias tương thích
		accounting_rows: accountingData.rows,                                   // Alias cũ tương thích
		sum_debit: htktFormatMoney(accountingData.totalDebitRaw),              // {sum_debit} : Tổng số tiền ghi Nợ (rút gọn từ calc_total_debit_amount)
		total_debit: htktFormatMoney(accountingData.totalDebitRaw),            // Alias tương thích
		calc_total_debit_amount: htktFormatMoney(accountingData.totalDebitRaw), // Alias cũ tương thích
		sum_credit: htktFormatMoney(accountingData.totalCreditRaw),            // {sum_credit}: Tổng số tiền ghi Có (rút gọn từ calc_total_credit_amount)
		total_credit: htktFormatMoney(accountingData.totalCreditRaw),          // Alias tương thích
		calc_total_credit_amount: htktFormatMoney(accountingData.totalCreditRaw), // Alias cũ tương thích

		/* =========================================================================
		 * 8. THÔNG TIN CHỮ KÝ VÀ METADATA XUẤT FILE PDF
		 * ========================================================================= */
		user_approver_dmms: "",                                                // Vị trí chữ ký Lãnh đạo phòng/ban đề nghị
		user_approver_kttc: "",                                                // Vị trí chữ ký Lãnh đạo phòng Kế toán
		blank_signature: "",                                                   // Vị trí chữ ký Chủ đầu tư dự án
		user_approver_final: "",                                               // Vị trí chữ ký Lãnh đạo Đơn vị

		payment_id: paymentId,
		created_by_username: createdByUsername,
		template_code: paymentTemplate.template_code,
		output_file_name:
				HTKT_COMMON.sanitizeFileName(
						"Phieu-de-nghi-thanh-toan-" + paymentId
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

function htktGetCurrentPaymentId(input) {
	var paymentId = "";
	if (input) {
		if (typeof input === "string") {
			paymentId = HTKT_COMMON.trim(input);
		} else {
			paymentId = HTKT_COMMON.readString(input, ["paymentId", "payment_id", "payment.id", "id"], "");
		}
	}
	if (!paymentId) {
		paymentId = HTKT_COMMON.getCurrentPaymentId(input);
	}
	if (!paymentId) {
		try {
			if (vars.$L_file) {
				paymentId = HTKT_COMMON.readString(vars.$L_file, ["id", "payment.id", "payment_id"], "");
			}
		} catch (e1) {
		}
	}
	if (!paymentId) {
		try {
			if (vars["$L.file"]) {
				paymentId = HTKT_COMMON.readString(vars["$L.file"], ["id", "payment.id", "payment_id"], "");
			}
		} catch (e2) {
		}
	}
	if (!paymentId) {
		try {
			if (vars["$L.parent"]) {
				paymentId = HTKT_COMMON.readString(vars["$L.parent"], ["id", "payment.id", "payment_id"], "");
			}
		} catch (e3) {
		}
	}
	if (!paymentId) {
		try {
			if (vars["$L.filed"]) {
				paymentId = HTKT_COMMON.readString(vars["$L.filed"], ["id", "payment.id", "payment_id"], "");
			}
		} catch (e4) {
		}
	}
	return HTKT_COMMON.trim(paymentId);
}

function generatePresentationPdf(input) {
	input = input || {};
	var paymentId = htktGetCurrentPaymentId(input);

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

	/* Đồng bộ hành vi cache với EFORMPrepayment.generatePresentationPdf. */
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
		data: {
			paymentId: paymentId,
			templateId: templateId,
			templateCode: mapped.templateCode,
			templateData: HTKT_COMMON.readBoolean(input, ["includeTemplateData", "include_template_data"], true)
					? mapped.data
					: null,
			pdfBase64: generated.data,
			mimeType: generated.mimeType || "application/pdf",
			encoding: generated.encoding || "base64",
			fileName: fileName,
			fromCache: generated.fromCache === true
		}
	};
}

function htktBuildPreviewContext(input) {
	var genRes = generatePresentationPdf(input);
	if (!genRes || !genRes.success) {
		return genRes || {success: false, message: "Không sinh được PDF."};
	}
	var d = genRes.data || {};
	return {
		success: true,
		message: "",
		paymentId: d.paymentId,
		templateId: d.templateId,
		templateCode: d.templateCode,
		templateData: d.templateData,
		pdfBase64: d.pdfBase64,
		mimeType: d.mimeType,
		encoding: d.encoding,
		fileName: d.fileName,
		fromCache: d.fromCache === true
	};
}


/* =============================================================================
 * 8. RENDER TRỰC TIẾP TRONG HTML VIEWER
 * ============================================================================= */

function RENDER() {
	var base64PDF = "";

	// Lay ban trinh ky hien hanh tu attachment/ECM (CURRENT hoac COMPLETED)
	try {
		var paymentId = HTKT_COMMON.getCurrentPaymentId({});
		var fetched = paymentId
				? (lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm_HTKT
						? lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm_HTKT({id: paymentId})
						: lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm({id: paymentId}))
				: null;

		if (fetched && fetched.success === true && fetched.data && fetched.data.Data) {
			var fileData = fetched.data.Data;
			for (var key in fileData) {
				base64PDF = htktEscapeForJavaScript(fileData[key]);
				break;
			}
		}
	} catch (e) {
		// bo qua
	}

	// Khong co ban luu -> gen moi
	if (!base64PDF) {
		var generated = generatePresentationPdf({
			useCache: true,
			includeTemplateData: false
		});

		if (!generated.success) {
			return htktBuildErrorHtml("PDF Preview", generated.message);
		}

		base64PDF = htktEscapeForJavaScript(generated.data.pdfBase64);
	}
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

/* =============================================================================
 * 9. RENDER IN PHIẾU (HTML VIEWER) - tự động mở hộp thoại in PDF
 * ============================================================================= */
function RENDER_PRINT() {
	var base64PDF = "";

	// Lay ban trinh ky hien hanh tu attachment/ECM (CURRENT hoac COMPLETED)
	try {
		var paymentId = HTKT_COMMON.getCurrentPaymentId({});
		var fetched = paymentId
				? (lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm_HTKT
						? lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm_HTKT({id: paymentId})
						: lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm({id: paymentId}))
				: null;

		if (fetched && fetched.success === true && fetched.data && fetched.data.Data) {
			var fileData = fetched.data.Data;
			for (var key in fileData) {
				base64PDF = htktEscapeForJavaScript(fileData[key]);
				break;
			}
		}
	} catch (e) {
		// bo qua
	}

	// Khong co ban luu -> gen moi
	if (!base64PDF) {
		var generated = generatePresentationPdf({
			useCache: true,
			includeTemplateData: false
		});

		if (!generated.success) {
			return htktBuildErrorHtml("In phieu", generated.message);
		}

		base64PDF = htktEscapeForJavaScript(generated.data.pdfBase64);
	}

	// Chi hien thi mot giao dien PDF; nguoi dung bam nut Print tren toolbar.
	return (
			"<div style='margin:0;padding:0;width:100%;height:100%;font-family:Arial,sans-serif;'>" +
			"<iframe id='htktPrintFrame' width='100%' height='100%' style='min-height:700px;border:none;background:#e5e7eb;'></iframe>" +
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
			"document.getElementById('htktPrintFrame').src=url+'#toolbar=1&navpanes=0&view=FitH';" +
			"window.addEventListener('beforeunload',function(){URL.revokeObjectURL(url);});" +
			"}catch(e){" +
			"document.body.innerHTML='<div style=\"padding:16px;color:red;font-family:Arial;\">Loi hien thi PDF: '+e+'</div>';" +
			"}" +
			"})();" +
			"</script>" +
			"</div>"
	);
}




