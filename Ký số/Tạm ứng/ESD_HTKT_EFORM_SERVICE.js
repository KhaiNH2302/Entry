var HTKT_COMMON = lib.ESD_HTKT_PREPAYMENT_COMMON;
var HTKT_TABLE = HTKT_COMMON.getTables();


var HTKT_DOC_SERVICE_BASE_URL = HTKT_COMMON.trim(lib.ESD_ENV_CONFIG.gendocUrl()).replace(/\/$/, "");
var HTKT_DOC_GENERATE_PDF_BASE64_PATH = "/api/generate/pdf/base64";
var HTKT_DOC_HTTP_TIMEOUT = 300;
var HTKT_DOC_MAX_BASE64_LENGTH = 5000000;


var HTKT_CASH_TEMPLATE_ID = "74dbcf4f-4c9c-4fb4-b4f7-3f49ec391d72";
var HTKT_CASH_TEMPLATE_CODE = "01-TUTM";
var HTKT_TRANSFER_TEMPLATE_ID = "c96c1273-ebc6-4eee-a636-a7b6f72b339e";
var HTKT_TRANSFER_TEMPLATE_CODE = "03-TUCK";
var HTKT_PREPAYMENT_RECIPIENT = "Lãnh đạo đơn vị";


function htktEscapeForJavaScript(value) {
	return HTKT_COMMON.toString(value)
			.replace(/\\/g, "\\\\")
			.replace(/'/g, "\\'")
			.replace(/\r/g, "")
			.replace(/\n/g, "");
}

function htktFormatMoney(value) {
	var amount = Number(value || 0);
	if (!isFinite(amount)) amount = 0;

	var parts = HTKT_COMMON.toString(Math.abs(amount)).split(".");
	var integerPart = parts[0];
	var decimalPart = parts.length > 1 ? parts[1] : "";
	var result = "";

	while (integerPart.length > 3) {
		result = "," + integerPart.substr(integerPart.length - 3) + result;
		integerPart = integerPart.substr(0, integerPart.length - 3);
	}

	result = integerPart + result;
	if (amount < 0) result = "-" + result;

	if (decimalPart !== "" && Number(decimalPart) !== 0) {
		result += "." + decimalPart;
	}

	return result;
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


/* =============================================================================
 * 3. ĐỌC THÔNG TIN NGƯỜI TẠO
 * ============================================================================= */

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


/* =============================================================================
 * 4. CHUYỂN SỐ THÀNH CHỮ TIẾNG VIỆT
 * ============================================================================= */

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
 * 5. MAP DỮ LIỆU TEMPLATE 01/TƯTM VÀ 03/TƯCK
 * ============================================================================= */

var HTKT_DEDUCTION_TYPE_FULL = "KHAUTRU_001";
var HTKT_DEDUCTION_TYPE_RATE = "KHAUTRU_002";
var HTKT_ENTRY_TYPE_AP = "AP";
var HTKT_ENTRY_TYPE_GL = "GL";
var HTKT_AUTO_ENTRY_ADVANCE = "TU-BT-01";
var HTKT_AUTO_ENTRY_TAX = "TU-BT-02";
var HTKT_AUTO_ENTRY_PAYMENT = "TU-BT-03";
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
			["citad.branch.code"],
			safeCitadCode
	);

	if (bankFile) {
		bankName = HTKT_COMMON.readString(bankFile, ["name"]);
	}

	HTKT_COMMON.closeFile(bankFile);
	HTKT_BANK_NAME_CACHE[safeCitadCode] = bankName;
	return bankName;
}

function htktGetPrepaymentVendorSourceRows(prepaymentId, defaultCurrency) {
	var result = [];
	var vendorFile = null;
	var rc = null;

	try {
		vendorFile = HTKT_COMMON.newReadOnlyFile(
				HTKT_TABLE.PREPAYMENT_VENDOR
		);
		rc = vendorFile.doSelect(
				'prepayment.id="' +
				HTKT_COMMON.escapeQueryValue(prepaymentId) +
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
					["beneficiary.bank"]
			);
			var amountRaw = HTKT_COMMON.readNumber(vendorFile, ["amount"]);

			result.push({
				vendor_id: vendorId,
				vendor_name: vendorInfo.name,
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
				beneficiary_bank_name: htktGetBankNameByCitadCode(
						htktGetFirstBeneficiaryBankCitadCode(beneficiaryBank)
				),
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

function htktGetDeductibleTaxByVendor(prepaymentId, sourceRows) {
	var taxByVendor = {};
	var invoiceLinkFile = null;
	var rc = null;

	try {
		invoiceLinkFile = HTKT_COMMON.newReadOnlyFile(
				HTKT_TABLE.PREPAYMENT_INVOICE
		);
		rc = invoiceLinkFile.doSelect(
				'prepayment.id="' +
				HTKT_COMMON.escapeQueryValue(prepaymentId) +
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

function htktBuildVendorTemplateRows(sourceRows, taxByVendor) {
	var rows = [];
	var totalAmountBeforeTaxRaw = 0;
	var totalTaxRaw = 0;
	var totalAmountRaw = 0;

	for (var i = 0; i < sourceRows.length; i++) {
		var source = sourceRows[i];
		var amountRaw = Number(source.amount_raw || 0);
		var taxRaw = Number(taxByVendor[source.vendor_id] || 0);
		var amountBeforeTaxRaw = Math.max(amountRaw - taxRaw, 0);
		var lineTotalRaw = amountRaw;

		rows.push({
			stt: i + 1,
			vendor_name: source.vendor_name || source.vendor_id,
			amount_before_tax: htktFormatMoney(amountBeforeTaxRaw),
			tax_amount: htktFormatMoney(taxRaw),
			line_total: htktFormatMoney(lineTotalRaw),
			note: ""
		});

		totalAmountBeforeTaxRaw += amountBeforeTaxRaw;
		totalTaxRaw += taxRaw;
		totalAmountRaw += lineTotalRaw;
	}

	return {
		rows: rows,
		totalAmountBeforeTaxRaw: totalAmountBeforeTaxRaw,
		totalTaxRaw: totalTaxRaw,
		totalAmountRaw: totalAmountRaw
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
			message: "Phiếu chưa có dữ liệu esdHTKTprepaymentVendor."
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
			stt: rows.length + 1,
			beneficiary_name: source.beneficiary_name,
			beneficiary_account: source.beneficiary_account,
			beneficiary_bank_name: source.beneficiary_bank_name,
			transaction_des: source.transaction_des,
			identity_number: source.identity_number,
			issued_date: htktFormatDateShort(source.issued_date_raw),
			issued_place: source.issued_place,
			phone: source.phone,
			amount: htktFormatMoney(amountRaw)
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

function htktGetPrepaymentEntrySourceRows(prepaymentId) {
	var result = [];
	var entryFile = null;
	var rc = null;

	try {
		entryFile = HTKT_COMMON.newReadOnlyFile(
				HTKT_TABLE.PREPAYMENT_ENTRY
		);
		rc = entryFile.doSelect(
				'prepayment.id="' +
				HTKT_COMMON.escapeQueryValue(prepaymentId) +
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

function htktGetGlGroupInfo(prepaymentId, entry) {
	var prefix = HTKT_COMMON.trim(prepaymentId) + ".GL.";
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

function htktBuildSupplementalEntryRows(prepaymentId, entryRows) {
	var groupsByKey = {};
	var groups = [];

	for (var i = 0; i < entryRows.length; i++) {
		var entry = entryRows[i];
		var normalizedType = htktNormalizePaymentMethod(entry.type);

		if (normalizedType !== HTKT_ENTRY_TYPE_GL) {
			continue;
		}

		var groupInfo = htktGetGlGroupInfo(prepaymentId, entry);
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
			amount: htktFormatMoney(groups[groupIndex].totalDebitRaw),
			note: ""
		});
	}

	return result;
}

function htktGetAccountingBankName(entry, vendorById) {
	var autoEntryCode = HTKT_COMMON.trim(entry.entry_type).toUpperCase();
	var vendor = vendorById[entry.vendor_id];

	if (autoEntryCode === HTKT_AUTO_ENTRY_ADVANCE) {
		return "VietinBank";
	}

	if (autoEntryCode === HTKT_AUTO_ENTRY_TAX) {
		return "";
	}

	if (autoEntryCode === HTKT_AUTO_ENTRY_PAYMENT && vendor) {
		if (htktIsCashPaymentMethod(vendor.payment_method)) {
			return "VietinBank";
		}

		return vendor.beneficiary_bank_name;
	}

	return "";
}

function htktBuildAccountingRows(entryRows, vendorSourceRows) {
	var vendorById = {};
	var rows = [];
	var totalDebitRaw = 0;
	var totalCreditRaw = 0;

	for (var vendorIndex = 0;
	     vendorIndex < vendorSourceRows.length;
	     vendorIndex++
	) {
		vendorById[vendorSourceRows[vendorIndex].vendor_id] =
				vendorSourceRows[vendorIndex];
	}

	for (var i = 0; i < entryRows.length; i++) {
		var entry = entryRows[i];
		var normalizedType = htktNormalizePaymentMethod(entry.type);

		if (normalizedType !== HTKT_ENTRY_TYPE_AP) {
			continue;
		}

		var amountRaw = Number(entry.amount_raw || 0);
		var accountSide = htktGetAccountSide(entry.account_type);
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
			stt: rows.length + 1,
			account_number: entry.account_number,
			account_name: entry.account_name,
			bank_name: htktGetAccountingBankName(entry, vendorById),
			description: entry.description,
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

function htktBuildTemplateData(prepaymentId) {
	/* Cache chỉ dùng trong một lần dựng phiếu để không giữ dữ liệu danh mục cũ. */
	HTKT_VENDOR_INFO_CACHE = {};
	HTKT_BANK_NAME_CACHE = {};

	var prepaymentFile = HTKT_COMMON.getPrepaymentRecord(prepaymentId);

	if (!prepaymentFile) {
		return {
			success: false,
			message:
					"Không tìm thấy phiếu " + prepaymentId +
					" trong esdHTKTprepayment."
		};
	}

	var createdAtValue = HTKT_COMMON.readValue(prepaymentFile, ["created.at"]);
	var createdByUsername = HTKT_COMMON.readString(
			prepaymentFile,
			["created.by"]
	);
	var departmentId = HTKT_COMMON.readString(prepaymentFile, ["department"]);
	var description = HTKT_COMMON.readString(prepaymentFile, ["description"]);
	var currency = HTKT_COMMON.readString(prepaymentFile, ["currency"]) || "VND";
	var vendorSourceRows = htktGetPrepaymentVendorSourceRows(
			prepaymentId,
			currency
	);
	var taxByVendor = htktGetDeductibleTaxByVendor(
			prepaymentId,
			vendorSourceRows
	);
	var vendorData = htktBuildVendorTemplateRows(
			vendorSourceRows,
			taxByVendor
	);
	var paymentTemplate = htktResolvePaymentTemplate(vendorSourceRows);

	if (!paymentTemplate.success) {
		HTKT_COMMON.closeFile(prepaymentFile);
		return paymentTemplate;
	}

	var paymentData = htktBuildPaymentTemplateRows(
			vendorSourceRows,
			paymentTemplate.kind
	);
	var entryRows = htktGetPrepaymentEntrySourceRows(prepaymentId);
	var supplementalEntryRows = htktBuildSupplementalEntryRows(
			prepaymentId,
			entryRows
	);
	var accountingData = htktBuildAccountingRows(
			entryRows,
			vendorSourceRows
	);
	var amountRaw = vendorData.totalAmountRaw;
	var amountWords = htktAmountToVietnameseWords(amountRaw, currency);
	var data = {
		unit_name: htktGetCreatorUnitName(createdByUsername),
		created_at: htktFormatDateLong(createdAtValue),
		id: prepaymentId,
		recipient: HTKT_PREPAYMENT_RECIPIENT,
		created_by: htktGetContactDisplayName(createdByUsername),
		department_name: htktGetOrgUnitName(departmentId),
		description: description,
		amount_raw: amountRaw,
		amount: htktFormatMoney(amountRaw),
		currency: currency,
		calc_amount_words: amountWords,

		vendor_rows: vendorData.rows,
		calc_total_amount_before_tax: htktFormatMoney(
				vendorData.totalAmountBeforeTaxRaw
		),
		calc_total_tax_amount: htktFormatMoney(vendorData.totalTaxRaw),
		calc_total_vendor_amount: htktFormatMoney(
				vendorData.totalAmountRaw
		),

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
		calc_total_payment_amount: htktFormatMoney(paymentData.totalRaw),
		calc_total_cash_amount: paymentTemplate.kind === "cash"
				? htktFormatMoney(paymentData.totalRaw)
				: "",
		calc_total_transfer_amount: paymentTemplate.kind === "transfer"
				? htktFormatMoney(paymentData.totalRaw)
				: "",

		accounting_rows: accountingData.rows,
		calc_total_debit_amount: htktFormatMoney(
				accountingData.totalDebitRaw
		),
		calc_total_credit_amount: htktFormatMoney(
				accountingData.totalCreditRaw
		),

		/* Giữ nguyên vị trí chữ ký, chưa nhúng ảnh vào template. */
		user_approver_dmms: "",
		user_approver_kttc: "",
		blank_signature: "",
		user_approver_final: "",

		prepayment_id: prepaymentId,
		created_by_username: createdByUsername,
		template_code: paymentTemplate.template_code,
		output_file_name:
				HTKT_COMMON.sanitizeFileName(
						"Phieu-de-nghi-tam-ung-" + prepaymentId
				) + ".pdf"
	};

	HTKT_COMMON.closeFile(prepaymentFile);

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

// trưởng thêm: API chung để WF sinh PDF và HTML Viewer preview 
function generatePresentationPdf(input) {
	input = input || {};
	var prepaymentId = HTKT_COMMON.getCurrentPrepaymentId(input);

	if (!prepaymentId) {
		return {
			success: false,
			message: "Không xác định được ID phiếu hiện tại."
		};
	}

	var mapped = htktBuildTemplateData(prepaymentId);
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

	var useCache = HTKT_COMMON.readBoolean(input, ["useCache", "use_cache"], true);
	var generated = useCache
			? htktGetPdfBase64Cached(templateId, mapped.data)
			: htktGeneratePdfBase64Response(templateId, mapped.data);
	if (!generated.success) {
		return generated;
	}

	var fileName = mapped.data.output_file_name;

	return {
		success: true,
		message: "",
		data: {
			prepaymentId: prepaymentId,
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




/* =============================================================================
 * 8. RENDER TRỰC TIẾP TRONG HTML VIEWER
 * ============================================================================= */

function RENDER() {
	var generated = generatePresentationPdf({
		useCache: true,
		includeTemplateData: false
	});

	if (!generated.success) {
		return htktBuildErrorHtml("PDF Preview", generated.message);
	}

	var context = generated.data;
	var base64PDF = htktEscapeForJavaScript(context.pdfBase64);

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