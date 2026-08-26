// update by : daint
// update date: 13/05

// update by : quangldt, function: requestConfirm
// update date: 18/05

// khai báo function
var createActivity = lib.ESD_Utils.createActivity;
var callRuleSet = lib.ESD_Utils.callRuleSet;

var updateStatusApproval = lib.ESD_MS_YCBG_COMMON.updateStatusApproval;
var setupStatusApproval = lib.ESD_MS_YCBG_COMMON.setupStatusApproval;
var getApprovalLevelByRecord = lib.ESD_MS_YCBG_COMMON.getApprovalLevelByRecord;
var checkAndAutoApprove = lib.ESD_MS_KMS_UTILS.checkAndAutoApprove;

var createScheduleSignatureYCBG = lib.ESD_MS_YCBG_SIGNATURE.createScheduleSignatureYCBG;

var sendMailToTCGMS = lib.ESD_MS_YCBG_ACTION_WF_SendEmail.sendMailToTCGMS;
var sendMailToChuDauTu = lib.ESD_MS_YCBG_ACTION_WF_SendEmail.sendMailToChuDauTu;
var sendMailToOwner = lib.ESD_MS_YCBG_ACTION_WF_SendEmail.sendMailToOwner;

// set const
var YCBGapprovalLevel = lib.ESD_MS_SETUP_CONST.getYCBGapprovalLevel();
var emailList = lib.ESD_MS_YCBG_ACTION_WF_SendEmail.getEmailList();

// get next Status and Current Phase
function resolveNextPhaseAndStatus(record) {
	var stepNextId = "";
	var phase = record.current_phase;
	switch (phase) {
		case "Lap YCBG/HSYC": {
			if (lib.ESD_MS_KMS_UTILS.isSkipXacNhan(record)) {
				stepNextId = "Phe duyet YCBG/HSYC";
			} else {
				stepNextId = "Xac nhan YCBG/HSYC";
			}

			break;
		}
		case "Xac nhan YCBG/HSYC":
			stepNextId = "Phe duyet YCBG/HSYC";
			break;
		case "Phe duyet YCBG/HSYC":
			stepNextId = "Theo doi";
			break;
	}

	var status = getStatusByPhase(stepNextId, record);

	return {
		status: status,
		currentPhase: stepNextId
	};
}

function getStatusByPhase(currentPhase, record) {
	switch (currentPhase) {
		case "Tao moi":
		case "Lap YCBG/HSYC":
			return "Tao moi";

		case "Xac nhan YCBG/HSYC":
			return "Cho xac nhan";

		case "Phe duyet YCBG/HSYC":
			return "Cho phe duyet";

		case "Theo doi":
			return "Da phe duyet";

		default:
			return "";
	}
}

// process action workflow
function executePlanWorkflowAction(record, actionCode, oldrecord) {
	switch (actionCode) {
			// ===== REQUEST / CONFIRM =====
		case "REQUEST_CONFIRM":
			requestConfirm(record);
			if (record.current_phase == "Phe duyet YCBG/HSYC") {
				sendMailToChuDauTu(record);
			} else {
				sendMailToTCGMS(record);
			}
			// setup trạng thái ban đầu của bước phê duyệt tiếp theo
			setupStatusApproval(record.id, getApprovalLevelByRecord(record));
			checkAndAutoApprove(record, YCBGapprovalLevel.ToChuyenGiaMS, confirm);
			break;

		case "CONFIRM":
			confirm(record);
			// cập nhật trạng thái người phê duyệt
			updateStatusApproval(record.id, getApprovalLevelByRecord(oldrecord));
			if (oldrecord.current_phase != record.current_phase) {
				sendMailToOwner(record, emailList.XacNhan);
				sendMailToChuDauTu(record);
				// setup trạng thái ban đầu của bước phê duyệt tiếp theo
				setupStatusApproval(record.id, getApprovalLevelByRecord(record));
			}
			break;

			// ===== APPROVAL =====
		case "APPROVAL":
			approval(record);
			// cập nhật trạng thái người phê duyệt
			updateStatusApproval(record.id, getApprovalLevelByRecord(oldrecord));
			sendMailToOwner(record, emailList.PheDuyet);

			break;

			// ===== EDIT =====
		case "REQ_EDIT":
			requestEdit(record);
			sendMailToOwner(record, emailList.YeuCauChinhSua);
			break;

			// ===== SIGNATURE =====
		case "SIGNATURE_CONFIRM":
			createScheduleSignatureYCBG(record.id, 20);
			break;

		case "SIGNATURE_APPROVAL":
			createScheduleSignatureYCBG(record.id, 20);
			sendMailToOwner(record, emailList.PheDuyet);
			break;

		default:
			print(
					"[ESD_MS_YCBG_ACTION_WF.executePlanWorkflowAction] ActionCode không hợp lệ: " + actionCode
			);
			break;
	}
}
// ===== REQUEST / CONFIRM =====
function requestConfirm(record) {
	var desActivity = "Gửi yêu cầu xác nhận.";
	createActivity("activityMSycbg", desActivity, record.id, "Gửi xác nhận");
}

function confirm(record) {
	var desActivity = "Chuyên gia mua sắm xác nhận";
	createActivity("activityMSycbg", desActivity, record.id, "Xác nhận");
}

// ===== APPROVAL =====
function approval(record) {
	var desActivity = "Đại diện chủ đầu tư phê duyệt.";
	createActivity("activityMSycbg", desActivity, record.id, "Phê duyệt");
}

// ===== EDIT =====
function requestEdit(record) {
	var desActivity = 'Yêu cầu chỉnh sửa với lý do: "' + vars["$G.change.reason"] + '"';
	createActivity("activityMSycbg", desActivity, record.id, "Yêu cầu chỉnh sửa");

	var f = new SCFile("esdMSkmsApproval");
	var rc = f.doSelect(`parent.id ="${record.id}"`);
	while (rc == RC_SUCCESS) {
		f.approval_status = "";
		f.approval_opinion = "";
		f.approval_date = null;

		f.doUpdate();
		rc = f.getNext();
	}
	if (f) f.doClose();
}

// ===== SIGNATURE =====
function signatureConfirm(record) {}

function signatureApproval(record) {}