# Builds either service: docker build --build-arg SERVICE=Order.Service .
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
ARG SERVICE
WORKDIR /src
COPY Directory.Build.props ./
COPY src/OrderPlatform.Contracts/*.csproj src/OrderPlatform.Contracts/
COPY src/OrderPlatform.Messaging/*.csproj src/OrderPlatform.Messaging/
COPY src/${SERVICE}/*.csproj src/${SERVICE}/
RUN dotnet restore src/${SERVICE}
COPY src/ src/
RUN dotnet publish src/${SERVICE} -c Release --no-restore -o /app /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0
ARG SERVICE
ENV ASPNETCORE_HTTP_PORTS=8080 \
    SERVICE_DLL=${SERVICE}.dll
WORKDIR /app
COPY --from=build /app .
USER app
EXPOSE 8080
ENTRYPOINT ["sh", "-c", "exec dotnet \"$SERVICE_DLL\""]
