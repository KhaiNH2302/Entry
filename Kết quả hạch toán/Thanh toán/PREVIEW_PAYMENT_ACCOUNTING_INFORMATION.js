/**
 * Preview esdHTKTaccountingInformation của Payment.
 *
 * READ-ONLY:
 * - Không insert/update/delete bất kỳ bảng nào.
 * - Chỉ dựng dữ liệu bằng ESD_HTKT_PAYMENT_ACCOUNTING_INFORMATION và print JSON.
 *
 * Chạy trực tiếp trong JavaScript Test: sửa PAYMENT_ID bên dưới.
 * Gọi qua gateway: { "name": "previewPaymentAccountingInformation",
 *                    "paymentId": "TT.xxx" }
 */

var PAYMENT_ID = 'TT.106.26.0100000';

run();

function run() {
	var input = null;
	try { input = vars['$L.file']; } catch (ignoreInput) {}

	var paymentId = getPaymentId(input);
	var result;
	try {
		if (!paymentId || paymentId === 'TT.XXX.XX.XXXXXXX') {
			result = { success: false, readOnly: true, error: 'Missing paymentId.' };
		} else {
			result = lib.ESD_HTKT_PAYMENT_ACCOUNTING_INFORMATION
					.previewPaymentAccountingInformation(paymentId);
		}
	} catch (e) {
		result = {
			success: false,
			readOnly: true,
			paymentId: paymentId,
			error: 'Preview Error: ' + e.toString()
		};
	}

	var output = JSON.stringify(result, null, 2);
	var printed = false;
	try {
		print(output);
		printed = true;
	} catch (ignorePrint) {}
	/* Một số màn JavaScript Test chỉ hiển thị giá trị return/queryReturn. */
	if (!printed) {
		try { system.functions.print(output); } catch (ignoreSystemPrint) {}
	}
	try { if (input) input.queryReturn = output; } catch (ignoreReturn) {}
	return result;
}

function getPaymentId(input) {
	if (!input) return PAYMENT_ID;

	var direct = readText(input, 'paymentId') || readText(input, 'payment.id');
	if (direct) return direct.trim();

	var details = parseObject(input.details);
	if (!details.paymentId) details = parseObject(input.queryString);

	return String(
			details.paymentId || details.payment_id || details.id || PAYMENT_ID
	).trim();
}

function parseObject(value) {
	if (!value) return {};
	if (typeof value === 'object') return value;
	try {
		var parsed = JSON.parse(value);
		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch (e) {
		return {};
	}
}

function readText(record, fieldName) {
	try {
		var value = record[fieldName];
		return value === null || value === undefined ? '' : String(value);
	} catch (e) {
		return '';
	}
}
