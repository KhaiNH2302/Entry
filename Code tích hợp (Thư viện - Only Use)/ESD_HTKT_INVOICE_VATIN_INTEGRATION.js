var logger = getLog("ESD_HTKT_INVOICE_VATIN_INTEGRATION");
/**
 * 1. Tải lên file hóa đơn (Upload Multipart)
 * Lưu ý: Đối với multipart/form-data phức tạp từ file nhị phân trong SM,
 * thông thường body truyền vào sẽ là một chuỗi raw multipart hoặc payload base64 tùy cấu hình gateway.
 */
function uploadInvoice(multipartBody) {

	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('vatin');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	//    var url = config.vatinBaseUrl + "/api/v1/upload";
	var url = config.vatinBaseUrl + "/api/v1/invoice/upload";
	var uniqueId = Math.random().toString(36).substring(2, 15) + new Date().getTime().toString(36);
	var boundary = "------WebKitFormBoundary" + uniqueId;

	// 2. Cấu hình Headers (Xóa application/json, thêm multipart/form-data kèm boundary)
	var headers = [
		new Header("Authorization", "Bearer " + token),
		new Header("Content-Type", "multipart/form-data; boundary=" + boundary)
	];

	// 3. Giả định đầu vào: multipartBody chứa file data (nội dung text/xml/base64 đã bóc tách)
	// Nếu multipartBody truyền vào dạng Object chứa { fileName, fileContent, branchCode, userName }
	var fileName = multipartBody.fileName || "test.xml";
	var fileContent = multipartBody.fileContent || "";
	var branchCode = multipartBody.branchCode || "MockBranchCode";
	var userName = multipartBody.userName || "MockUserName";

	// 4. Dựng cấu trúc Body chuỗi thủ công theo chuẩn cURL/Postman
	var body = "";

	// Field 1: file
	body += "--" + boundary + "\r\n";
	body += "Content-Disposition: form-data; name=\"file\"; filename=\"" + fileName + "\"\r\n";
	body += "Content-Type: application/xml\r\n\r\n"; // Dùng octet-stream cho file zip/binary
	body += fileContent + "\r\n";

	// Field 2: branchCode
	body += "--" + boundary + "\r\n";
	body += "Content-Disposition: form-data; name=\"branchCode\"\r\n\r\n";
	body += branchCode + "\r\n";

	// Field 3: userName
	body += "--" + boundary + "\r\n";
	body += "Content-Disposition: form-data; name=\"userName\"\r\n\r\n";
	body += userName + "\r\n";

	// Kết thúc chuỗi Multipart bằng dấu -- ở cuối boundary
	body += "--" + boundary + "--\r\n";

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, body, headers);
	logger.info('uploadInvoice: ' + responseStr);
	if (responseStr) {
		return rteJSONParse(responseStr);
	}
	return null;
}

/**
 * 2. Xóa dữ liệu hóa đơn theo ID
 * @param {string} id - Định danh UUID của hóa đơn cần xóa
 */
function deleteInvoice(id, userUpload, userDelete) {
	var token = lib.ESD_HTKT_BASE_API_INTEGRATION.getActiveToken('vatin');
	var config = lib.ESD_HTKT_BASE_API_INTEGRATION.getConfigSystem();
	if (!token || !config) return null;

	var url = config.vatinBaseUrl + `/api/v1/invoice/delete/${id}`;
	var uniqueId = Math.random().toString(36).substring(2, 15) + new Date().getTime().toString(36);
	var boundary = "------WebKitFormBoundary" + uniqueId;

	// 2. Cấu hình Headers (Xóa application/json, thêm multipart/form-data kèm boundary)
	var headers = [
		new Header("Authorization", "Bearer " + token),
		new Header("Content-Type", "multipart/form-data; boundary=" + boundary)
	];
	var body = "";

	body += "--" + boundary + "\r\n";
	body += "Content-Disposition: form-data; name=\"userUpload\"\r\n\r\n";
	body += userUpload + "\r\n";

	body += "--" + boundary + "\r\n";
	body += "Content-Disposition: form-data; name=\"userDelete\"\r\n\r\n";
	body += userDelete + "\r\n";
	body += "--" + boundary + "--\r\n";

	var responseStr = lib.ESD_COMMON_HTTP.postJson(url, body, headers);
	logger.info('deleteInvoice: ' + responseStr);
	if (responseStr) {
		return rteJSONParse(responseStr);
	}
	return null;
}

