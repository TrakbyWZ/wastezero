using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Options;
using WasteZero.WindowsUploadService.Configuration;
using WasteZero.WindowsUploadService.Logging;
using WasteZero.WindowsUploadService.Services;

var contentRoot = ResolveContentRoot(args);

try
{
    var host = Host.CreateDefaultBuilder(args)
        .UseContentRoot(contentRoot)
        .UseWindowsService()
        .ConfigureServices((ctx, services) =>
        {
            services.AddOptions<UploadServiceOptions>()
                .Bind(ctx.Configuration.GetSection("UploadService"))
                .ValidateOnStart();
            services.AddSingleton<IValidateOptions<UploadServiceOptions>, UploadServiceOptionsValidator>();
            services.AddSingleton<IPostConfigureOptions<UploadServiceOptions>, UploadServiceOptionsPostConfigure>();

            services.TryAddEnumerable(ServiceDescriptor.Singleton<ILoggerProvider, RotatingFileLoggerProvider>());
            services.AddSingleton<IUploadStateStore, SqliteUploadStateStore>();
            services.AddHttpClient();
            services.AddHostedService<UploadBackgroundService>();
        })
        .ConfigureLogging(logging =>
        {
            logging.AddEventLog(settings => settings.SourceName = "WasteZeroUpload");
            logging.SetMinimumLevel(LogLevel.Information);
        })
        .Build();

    await host.RunAsync().ConfigureAwait(false);
    return 0;
}
catch (OptionsValidationException ex)
{
    await Console.Error.WriteLineAsync("Configuration error:").ConfigureAwait(false);
    foreach (var failure in ex.Failures)
        await Console.Error.WriteLineAsync("  " + failure).ConfigureAwait(false);
    return 1;
}

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
