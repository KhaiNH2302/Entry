/**
 * =============================================================================
 * SCRIPT CHẨN ĐOÁN & KIỂM TRA LỖI LẤY FILE TỪ ECM - THANH TOÁN (PAYMENT)
 * =============================================================================
 *
 * Mục đích:
 * - Chạy trực tiếp trong JavaScript Test / Rad Script Debugger của Service Manager.
 * - Kiểm tra từng bước: từ truy vấn Database SM -> Kiểm tra Thư viện -> Gọi hàm Document -> Gọi ECM thật.
 * - In ra kết luận chính xác code đang "chết" ở bước nào và vì lý do gì.
 *
 * Hướng dẫn sử dụng:
 * 1. Thay đổi biến `PAYMENT_ID` bên dưới bằng mã phiếu bạn đang test (ví dụ: 'TT.106.26.0000001').
 * 2. Paste toàn bộ nội dung script vào JavaScript Test (hoặc Script Debugger) và ấn Execute.
 * 3. Xem kết quả chẩn đoán chi tiết trong màn hình console/log.
 * =============================================================================
 */

var PAYMENT_ID = "TT.106.26.0000001"; // <--- ĐIỀN MÃ PHIẾU THANH TOÁN CẦN CHECK VÀO ĐÂY

runDiagnostics();

function runDiagnostics() {
	var input = null;
	try { input = vars["$L.file"]; } catch (e) {}

	var paymentId = getTargetPaymentId(input);
	var report = {
		paymentId: paymentId,
		timestamp: String(system.functions.tod()),
		step1_PaymentRecord: null,
		step2_AttachmentRecords: null,
		step3_LibrariesAndConfig: null,
		step4_GetFileEcmCall: null,
		step5_DirectEcmDownload: null,
		conclusion: []
	};

	logHeader("BẮT ĐẦU CHẨN ĐOÁN LỖI LẤY FILE ECM CHO PHIẾU: " + paymentId);

	// =========================================================================
	// BƯỚC 1: KIỂM TRA BẢN GHI PHIẾU THANH TOÁN (esdHTKTpayment)
	// =========================================================================
	logSection("BƯỚC 1: KIỂM TRA BẢNG CHÍNH esdHTKTpayment");
	try {
		var paymentFile = new SCFile("esdHTKTpayment", SCFILE_READONLY);
		var rcPay = paymentFile.doSelect('id="' + paymentId + '"');
		if (rcPay === RC_SUCCESS) {
			report.step1_PaymentRecord = {
				found: true,
				id: String(paymentFile.id || ""),
				status: String(paymentFile.status || ""),
				currentPhase: String(paymentFile["current.phase"] || paymentFile.current_phase || ""),
				title: String(paymentFile.title || paymentFile.brief_description || "")
			};
			print("[BƯỚC 1 - OK] Tìm thấy phiếu thanh toán: " + paymentId + " (Status: " + report.step1_PaymentRecord.status + ")");
		} else {
			report.step1_PaymentRecord = { found: false, rc: rcPay };
			print("[BƯỚC 1 - CẢNH BÁO] KHÔNG TÌM THẤY bản ghi " + paymentId + " trong bảng esdHTKTpayment! (doSelect RC=" + rcPay + ")");
			report.conclusion.push("KHÔNG TÌM THẤY bản ghi trong bảng esdHTKTpayment với id=" + paymentId);
		}
		try { paymentFile.doClose(); } catch (e) {}
	} catch (errPay) {
		report.step1_PaymentRecord = { error: String(errPay) };
		print("[BƯỚC 1 - LỖI] Lỗi query bảng esdHTKTpayment: " + errPay);
		report.conclusion.push("Lỗi query bảng esdHTKTpayment: " + errPay);
	}

	// =========================================================================
	// BƯỚC 2: KIỂM TRA BẢNG ATTACHMENT (esdHTKTpaymentAttachment)
	// =========================================================================
	logSection("BƯỚC 2: KIỂM TRA DỮ LIỆU BẢNG esdHTKTpaymentAttachment");
	var validAttachments = [];
	var rawAttachments = [];
	try {
		var attachFile = new SCFile("esdHTKTpaymentAttachment", SCFILE_READONLY);
		var queryAttach = 'payment.id="' + paymentId + '"';
		var rcAttach = attachFile.doSelect(queryAttach);
		var count = 0;

		while (rcAttach === RC_SUCCESS && count < 100) {
			count++;
			var item = {
				id: String(attachFile.id || "").trim(),
				paymentId: String(attachFile["payment.id"] || "").trim(),
				name: String(attachFile.name || "").trim(),
				docCode: String(attachFile["doc.code"] || "").trim(),
				groupCode: String(attachFile["group.code"] || "").trim(),
				type: String(attachFile.type || "").trim(),
				status: String(attachFile.status || "").trim(),
				ecmDocId: String(attachFile["ecm.doc.id"] || "").trim(),
				ecmObjectId: String(attachFile["ecm.object.id"] || "").trim(),
				size: attachFile.size || 0,
				uploadedBy: String(attachFile["uploaded.by"] || "").trim(),
				uploadedAt: String(attachFile["uploaded.at"] || "")
			};
			rawAttachments.push(item);

			// Kiểm tra điều kiện active
			var isTrinhKy = item.type === "Trinh ky" || item.type === "TRINH_KY" || item.docCode === "TRINH_KY";
			var isActiveStatus = !item.status || item.status === "CURRENT" || item.status === "COMPLETED";

			if (isTrinhKy && isActiveStatus) {
				validAttachments.push(item);
			}

			rcAttach = attachFile.getNext();
		}
		try { attachFile.doClose(); } catch (e) {}

		report.step2_AttachmentRecords = {
			totalFound: rawAttachments.length,
			validActiveCount: validAttachments.length,
			records: rawAttachments
		};

		print("[BƯỚC 2 - TỔNG QUAN] Tìm thấy tổng cộng " + rawAttachments.length + " bản ghi attachment cho phiếu " + paymentId);
		for (var i = 0; i < rawAttachments.length; i++) {
			var att = rawAttachments[i];
			print("  -> [" + (i + 1) + "] ID=" + att.id + " | Name=" + att.name + " | type=" + att.type + " | doc.code=" + att.docCode + " | status=" + att.status + " | ecm.doc.id=" + att.ecmDocId + " | ecm.object.id=" + att.ecmObjectId);
		}

		if (rawAttachments.length === 0) {
			print("  ❌ CHẾT TẠI DB: Bảng esdHTKTpaymentAttachment hoàn toàn KHÔNG có bản ghi nào cho payment.id=" + paymentId);
			report.conclusion.push("CHẾT TẠI DB (BƯỚC 2): Bảng esdHTKTpaymentAttachment không có bản ghi nào. Phiếu chưa từng được sinh và lưu file trình ký.");
		} else if (validAttachments.length === 0) {
			print("  ❌ CHẾT TẠI DB: Có " + rawAttachments.length + " bản ghi nhưng KHÔNG bản ghi nào thoả mãn (type='Trinh ky' VÀ status in ['CURRENT', 'COMPLETED'])!");
			report.conclusion.push("CHẾT TẠI BỘ LỌC DB (BƯỚC 2): Tìm thấy " + rawAttachments.length + " attachment nhưng không có bản ghi nào có type='Trinh ky' và status='CURRENT'/'COMPLETED'.");
		} else if (validAttachments.length > 1) {
			print("  ⚠️ XUNG ĐỘT DB: Có " + validAttachments.length + " bản ghi cùng ở trạng thái CURRENT/COMPLETED!");
			report.conclusion.push("XUNG ĐỘT DB (BƯỚC 2): Phiếu đang có " + validAttachments.length + " bản trình ký hiện hành cùng lúc.");
		} else {
			var activeAtt = validAttachments[0];
			print("  ✅ [BƯỚC 2 - OK] Xác định đúng 1 bản trình ký hiện hành: ID=" + activeAtt.id + ", ObjectId=" + activeAtt.ecmObjectId + ", DocId=" + activeAtt.ecmDocId);
			if (!activeAtt.ecmObjectId && !activeAtt.ecmDocId) {
				print("  ❌ LỖI ECM ID: Bản ghi attachment này bị TRỐNG cả ecm.object.id và ecm.doc.id!");
				report.conclusion.push("LỖI DỮ LIỆU ATTACHMENT (BƯỚC 2): ecm.object.id và ecm.doc.id đều bị rỗng trong DB.");
			}
		}
	} catch (errAttach) {
		report.step2_AttachmentRecords = { error: String(errAttach) };
		print("[BƯỚC 2 - LỖI] Ngoại lệ khi truy vấn bảng esdHTKTpaymentAttachment: " + errAttach);
		report.conclusion.push("LỖI NGOẠI LỆ DB (BƯỚC 2): Query bảng esdHTKTpaymentAttachment ném lỗi: " + errAttach);
	}

	// =========================================================================
	// BƯỚC 3: KIỂM TRA THƯ VIỆN & CẤU HÌNH MÔI TRƯỜNG
	// =========================================================================
	logSection("BƯỚC 3: KIỂM TRA CONTRACT THƯ VIỆN & CẤU HÌNH MÔI TRƯỜNG");
	var envCheck = {
		hasCommon: !!(lib.ESD_HTKT_PAYMENT_COMMON && typeof lib.ESD_HTKT_PAYMENT_COMMON.ok === "function"),
		hasDocLib: !!(lib.ESD_HTKT_PAYMENT_DOCUMENT),
		hasEnvConfig: !!(lib.ESD_ENV_CONFIG && typeof lib.ESD_ENV_CONFIG.getENV === "function"),
		hasEcmService: !!(lib.ESD_ECM_SERVICE && typeof lib.ESD_ECM_SERVICE.downloadDocument === "function"),
		environment: "UNKNOWN",
		ecmUrlFromConfig: "EMPTY"
	};

	if (envCheck.hasEnvConfig) {
		try { envCheck.environment = String(lib.ESD_ENV_CONFIG.getENV() || ""); } catch (eEnv) {}
		try { envCheck.ecmUrlFromConfig = String(lib.ESD_ENV_CONFIG.esdEcmService() || ""); } catch (eUrl) {}
	}

	report.step3_LibrariesAndConfig = envCheck;
	print("  - ESD_HTKT_PAYMENT_COMMON: " + (envCheck.hasCommon ? "✅ OK" : "❌ THIẾU"));
	print("  - ESD_HTKT_PAYMENT_DOCUMENT: " + (envCheck.hasDocLib ? "✅ OK" : "❌ THIẾU"));
	print("  - ESD_ENV_CONFIG: " + (envCheck.hasEnvConfig ? "✅ OK (Môi trường: " + envCheck.environment + ", ECM URL: " + envCheck.ecmUrlFromConfig + ")" : "⚠️ Không có"));
	print("  - ESD_ECM_SERVICE: " + (envCheck.hasEcmService ? "✅ OK" : "❌ THIẾU"));

	if (!envCheck.hasCommon) {
		report.conclusion.push("THIẾU THƯ VIỆN: lib.ESD_HTKT_PAYMENT_COMMON chưa được compile hoặc không tồn tại.");
	}
	if (!envCheck.hasDocLib) {
		report.conclusion.push("THIẾU THƯ VIỆN: lib.ESD_HTKT_PAYMENT_DOCUMENT chưa được compile hoặc không tồn tại.");
	}

	// =========================================================================
	// BƯỚC 4: THỬ GỌI TRỰC TIẾP HÀM get_file_ecm_HTKT
	// =========================================================================
	logSection("BƯỚC 4: TEST GỌI HÀM lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm_HTKT");
	if (envCheck.hasDocLib) {
		try {
			var getFn = lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm_HTKT || lib.ESD_HTKT_PAYMENT_DOCUMENT.get_file_ecm;
			if (typeof getFn !== "function") {
				print("  ❌ Không tìm thấy hàm get_file_ecm_HTKT hoặc get_file_ecm trong lib.ESD_HTKT_PAYMENT_DOCUMENT!");
				report.step4_GetFileEcmCall = { success: false, error: "FUNCTION_NOT_FOUND" };
				report.conclusion.push("LỖI CONTRACT (BƯỚC 4): lib.ESD_HTKT_PAYMENT_DOCUMENT không có hàm get_file_ecm_HTKT.");
			} else {
				var getResult = getFn({ id: paymentId });
				report.step4_GetFileEcmCall = getResult;

				if (getResult && getResult.success === true) {
					var fileData = getResult.data && getResult.data.Data || {};
					var fileKeys = Object.keys(fileData);
					var firstBase64 = fileKeys.length > 0 ? fileData[fileKeys[0]] : "";
					print("  ✅ [BƯỚC 4 - THÀNH CÔNG] get_file_ecm_HTKT trả về thành công!");
					print("     -> File Name: " + fileKeys.join(", "));
					print("     -> Base64 Length: " + (firstBase64 ? firstBase64.length : 0) + " ký tự");
				} else {
					print("  ❌ [BƯỚC 4 - THẤT BẠI] get_file_ecm_HTKT trả về lỗi:");
					print("     -> Code: " + (getResult && getResult.code || "UNKNOWN"));
					print("     -> Message: " + (getResult && getResult.message || "UNKNOWN"));
					print("     -> Detail: " + (getResult && getResult.detail || "NONE"));
					report.conclusion.push("LỖI TẠI get_file_ecm_HTKT (BƯỚC 4): Code=" + (getResult && getResult.code) + " | Message=" + (getResult && getResult.message) + " | Detail=" + (getResult && getResult.detail));
				}
			}
		} catch (errGetEcm) {
			report.step4_GetFileEcmCall = { exception: String(errGetEcm) };
			print("  ❌ [BƯỚC 4 - NGOẠI LỆ] Ném exception khi gọi get_file_ecm_HTKT: " + errGetEcm);
			report.conclusion.push("LỖI NGOẠI LỆ RUNTIME (BƯỚC 4): get_file_ecm_HTKT ném lỗi: " + errGetEcm);
		}
	}

	// =========================================================================
	// BƯỚC 5: THỬ GỌI TRỰC TIẾP DOWNLOAD TỪ ECM SERVICE (NẾU CÓ OBJECT ID)
	// =========================================================================
	logSection("BƯỚC 5: TEST GỌI TRỰC TIẾP DỊCH VỤ ECM");
	if (validAttachments.length > 0 && validAttachments[0].ecmObjectId && envCheck.hasEcmService) {
		var targetObjectId = validAttachments[0].ecmObjectId;
		try {
			print("  -> Thử tải trực tiếp với DOC_OBJECTID=" + targetObjectId + " qua lib.ESD_ECM_SERVICE.downloadDocument...");
			var rawDownloadResp = lib.ESD_ECM_SERVICE.downloadDocument([{
				DOC_OBJECTID: targetObjectId,
				APP_ID: "NEWTPSS",
				SESSION_ID: "csep_session"
			}]);
			report.step5_DirectEcmDownload = rawDownloadResp;

			if (rawDownloadResp && rawDownloadResp.success === true) {
				var respData = rawDownloadResp.data || {};
				print("  ✅ [BƯỚC 5 - THÀNH CÔNG] ECM Service kết nối tốt, phản hồi: Code=" + (respData.Code || "OK"));
			} else {
				print("  ❌ [BƯỚC 5 - THẤT BẠI] ECM Service trả về lỗi hoặc không kết nối được:");
				print("     -> Error: " + JSON.stringify(rawDownloadResp));
				report.conclusion.push("LỖI KẾT NỐI ECM (BƯỚC 5): Không tải được file từ ECM với ObjectId=" + targetObjectId + ". Chi tiết: " + JSON.stringify(rawDownloadResp));
			}
		} catch (errDirectEcm) {
			report.step5_DirectEcmDownload = { exception: String(errDirectEcm) };
			print("  ❌ [BƯỚC 5 - NGOẠI LỆ] Lỗi ngoại lệ khi gọi ESD_ECM_SERVICE: " + errDirectEcm);
			report.conclusion.push("LỖI NGOẠI LỆ ECM (BƯỚC 5): " + errDirectEcm);
		}
	} else {
		print("  ℹ️ [BƯỚC 5 - BỎ QUA] Không có ObjectId hợp lệ từ DB để test gọi trực tiếp ECM.");
	}

	// =========================================================================
	// TỔNG KẾT & KẾT LUẬN
	// =========================================================================
	logHeader("TỔNG KẾT & KẾT LUẬN ĐIỂM CHẾT");
	if (report.conclusion.length === 0) {
		print("🎉 HOÀN TOÀN KHÔNG CÓ LỖI! Dữ liệu DB và kết nối ECM của phiếu " + paymentId + " đều hoạt động hoàn hảo.");
	} else {
		print("⚠️ PHÁT HIỆN CÁC ĐIỂM NGHẼN/LỖI SAU:");
		for (var k = 0; k < report.conclusion.length; k++) {
			print("  " + (k + 1) + ". " + report.conclusion[k]);
		}
	}
	logHeader("KẾT THÚC CHẨN ĐOÁN");

	try { if (input) input.queryReturn = JSON.stringify(report, null, 2); } catch (e) {}
	return report;
}

function getTargetPaymentId(input) {
	if (!input) return PAYMENT_ID;
	var direct = null;
	try { direct = input.paymentId || input.id || input["payment.id"]; } catch (e) {}
	if (direct) return String(direct).trim();
	return PAYMENT_ID;
}

function logHeader(text) {
	print("\n================================================================================");
	print("  " + text);
	print("================================================================================");
}

function logSection(title) {
	print("\n--- " + title + " ---");
}
