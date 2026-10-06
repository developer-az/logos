# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json Metrics.sln ./
COPY src/Metrics.Core/Metrics.Core.csproj src/Metrics.Core/
COPY src/Metrics.Service/Metrics.Service.csproj src/Metrics.Service/
RUN dotnet restore src/Metrics.Service/Metrics.Service.csproj
COPY src/ src/
RUN dotnet publish src/Metrics.Service/Metrics.Service.csproj -c Release -o /app --no-restore

# The aspnet image bundles glibc, which librdkafka (inside Confluent.Kafka) needs.
FROM mcr.microsoft.com/dotnet/aspnet:10.0
WORKDIR /app
COPY --from=build /app .
ENV ASPNETCORE_HTTP_PORTS=8080
EXPOSE 8080
USER app
ENTRYPOINT ["dotnet", "Metrics.Service.dll"]
