using System.Text.Json;

namespace WasteZero.WindowsUploadService.Services;

public static class DuplicateResponseClassifier
{
    /// <summary>
    /// True when the API body indicates duplicate filename / unique constraint (do not retry).
    /// </summary>
    public static bool IsDuplicateFilenameError(string? responseBody)
    {
        if (string.IsNullOrEmpty(responseBody))
            return false;

        var text = responseBody;
        try
        {
            using var doc = JsonDocument.Parse(responseBody);
            if (doc.RootElement.TryGetProperty("error", out var err) && err.ValueKind == JsonValueKind.String)
                text = err.GetString() ?? text;
        }
        catch (JsonException)
        {
            // use raw body
        }

        var lower = text.ToLowerInvariant();
        return lower.Contains("idx_unique_log_files_filename", StringComparison.Ordinal)
               || lower.Contains("duplicate key value", StringComparison.Ordinal)
               || (lower.Contains("unique constraint", StringComparison.Ordinal)
                   && lower.Contains("filename", StringComparison.Ordinal));
    }
}
