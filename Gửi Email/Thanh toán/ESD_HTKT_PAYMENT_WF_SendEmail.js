/**
 * ScriptLibrary : ESD_HTKT_PAYMENT_WF_SendEmail
 * -----------------------------------------------------------------------------
 * Module        : HTKT - Gửi Email Đề nghị thanh toán
 * Version       : 1.0.0
 * Environment   : OpenText Service Manager (JavaScript ES5 Engine)
 *
 * Chức năng:
 * - Xử lý gửi email thông báo cho toàn bộ chu trình Workflow ESD_HTKT_PAYMENT_WF.
 * - Quản lý danh mục Template thanh toán (TEM_TT01 -> TEM_TT05).
 * - Giải phóng an toàn các biến toàn cục $G.mail.* sau mỗi lần gửi.
 * -----------------------------------------------------------------------------
 */

var callRuleSet = lib.ESD_Utils.callRuleSet;
var getCommonName = lib.ESD_Utils.getCommonName;

/**
 * Danh sách mã Template Email phân hệ Thanh toán
 */
var emailList = {
	"YeuCauPheDuyet": "TEM_TT01",   // Yêu cầu rà soát / phê duyệt / tiếp nhận theo phase
	"YeuCauChinhSua": "TEM_TT02",   // Yêu cầu chỉnh sửa / trả về hồ sơ (returnToUpdate)
	"PheDuyet":       "TEM_TT03",   // Hồ sơ đã được cấp thẩm quyền phê duyệt / ký số xong
	"HoanThanhChi":   "TEM_TT04",   // Thông báo hoàn tất hạch toán OGL / chi tiền
	"CanhBaoHanTT":   "TEM_TT05"    // Cảnh báo sắp đến hạn thanh toán
};

function getEmailList() {
	return emailList;
}

// ===== HÀM DỌN DẸP BIẾN TOÀN CỤC =====
function cleanGlobalVariable() {
	vars["$G.mail.receiver"] = null;
	vars["$G.mail.receiver.name"] = null;
	vars["$G.mail.tem"] = null;
}

// ===== HÀM GỬI EMAIL CHUẨN DÙNG CHUNG =====
function sendMailPayment(record, user, template) {
	if (!record || !user || !user.email) {
		return false;
	}
	try {
		vars["$G.mail.receiver"] = [user.email];
		vars["$G.mail.receiver.name"] = user["full.name"] || user.fullName || "";
		vars["$G.mail.tem"] = template;

		callRuleSet(record, "ESD_HTKT_PAYMENT_SENDEMAIL");
		return true;
	} catch (e) {
		print("[ESD_HTKT_PAYMENT_WF_SendEmail.sendMailPayment] Error: " + e);
		return false;
	} finally {
		cleanGlobalVariable();
	}
}

/**
 * 1. Gửi email thông báo cho Người tạo hồ sơ (Owner)
 */
function sendMailToOwner(record, template) {
	var createdBy = record["created.by"] || record.created_by;
	if (!createdBy) return false;

	var userOwner = lib.ESD_Utils.getOneRecord("contacts", 'contact.name="' + createdBy + '"', ["email", "full.name"]);
	if (userOwner && userOwner.email) {
		return sendMailPayment(record, userOwner, template);
	}
	return false;
}

/**
 * 2. Gửi email yêu cầu xử lý / rà soát / phê duyệt cho người nhận theo Phase
 */
function sendMailToPhaseApprover(record, approverContactId) {
	if (!approverContactId) return false;

	var approver = lib.ESD_Utils.getOneRecord("contacts", 'contact.name="' + approverContactId + '"', ["email", "full.name"]);
	if (approver && approver.email) {
		return sendMailPayment(record, approver, emailList.YeuCauPheDuyet);
	}
	return false;
}

/**
 * 3. Gửi email thông báo yêu cầu chỉnh sửa hồ sơ thanh toán (khi gọi returnToUpdate)
 */
function sendMailOnReturn(record) {
	return sendMailToOwner(record, emailList.YeuCauChinhSua);
}

/**
 * 4. Gửi email thông báo hồ sơ thanh toán đã được phê duyệt / ký số xong (approval_final)
 */
function sendMailOnApproved(record) {
	return sendMailToOwner(record, emailList.PheDuyet);
}

/**
 * 5. Gửi email thông báo đã thực chi / hạch toán thành công (accounted)
 */
function sendMailOnAccounted(record) {
	// Gửi cho người lập hồ sơ
	sendMailToOwner(record, emailList.HoanThanhChi);

	// Gửi cho người theo dõi hợp đồng liên quan (nếu có)
	if (record.contract_id) {
		var contractExecutor = getCommonName("esdHDcontract", 'id="' + record.contract_id + '"', "executor.id");
		if (contractExecutor) {
			var executorContact = lib.ESD_Utils.getOneRecord("contacts", 'contact.name="' + contractExecutor + '"', ["email", "full.name"]);
			if (executorContact) {
				sendMailPayment(record, executorContact, emailList.HoanThanhChi);
			}
		}
	}
}
