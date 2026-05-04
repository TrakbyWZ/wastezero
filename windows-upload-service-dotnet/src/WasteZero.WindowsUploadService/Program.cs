using WasteZero.WindowsUploadService.Configuration;
using WasteZero.WindowsUploadService.Logging;
using WasteZero.WindowsUploadService.Services;

var contentRoot = ResolveContentRoot(args);

UploadServiceOptions uploadOptions;
try
{
    uploadOptions = UploadServiceConfigurationLoader.Load(contentRoot);
}
catch (Exception ex)
{
    await Console.Error.WriteLineAsync("Configuration error: " + ex.Message).ConfigureAwait(false);
    return 1;
}

var host = Host.CreateDefaultBuilder(args)
    .UseContentRoot(contentRoot)
    .UseWindowsService()
    .ConfigureServices(services =>
    {
        services.AddSingleton(Microsoft.Extensions.Options.Options.Create(uploadOptions));
        services.AddSingleton<IUploadStateStore, SqliteUploadStateStore>();
        services.AddHttpClient();
        services.AddHostedService<UploadBackgroundService>();
    })
    .ConfigureLogging(logging =>
    {
        logging.AddEventLog(settings => settings.SourceName = "WasteZeroUpload");
        logging.AddProvider(new RotatingFileLoggerProvider(Microsoft.Extensions.Options.Options.Create(uploadOptions), contentRoot));
        logging.SetMinimumLevel(LogLevel.Information);
    })
    .Build();

await host.RunAsync().ConfigureAwait(false);
return 0;

static string ResolveContentRoot(string[] args)
{
    const string prefix = "--contentRoot=";
    foreach (var a in args)
    {
        if (!a.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            continue;
        var path = a[prefix.Length..].Trim().Trim('"');
        if (!string.IsNullOrWhiteSpace(path))
            return Path.GetFullPath(path);
    }

    return AppContext.BaseDirectory;
}
