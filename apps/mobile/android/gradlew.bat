@ECHO OFF
SETLOCAL
SET APP_HOME=%~dp0
SET WRAPPER_JAR=%APP_HOME%gradle\wrapper\gradle-wrapper.jar

IF EXIST "%WRAPPER_JAR%" GOTO run
IF NOT EXIST "%APP_HOME%local.properties" (
  ECHO android\local.properties is missing; run flutter pub get first. 1>&2
  EXIT /B 1
)
FOR /F "usebackq tokens=1,* delims==" %%A IN ("%APP_HOME%local.properties") DO (
  IF "%%A"=="flutter.sdk" SET FLUTTER_SDK=%%B
)
IF NOT DEFINED FLUTTER_SDK (
  ECHO flutter.sdk is missing from android\local.properties. 1>&2
  EXIT /B 1
)
SET WRAPPER_JAR=%FLUTTER_SDK%\bin\cache\artifacts\gradle_wrapper\gradle-wrapper.jar

:run
IF NOT EXIST "%WRAPPER_JAR%" (
  ECHO Flutter Gradle wrapper artifact is missing; run flutter precache --android. 1>&2
  EXIT /B 1
)
java %JAVA_OPTS% %GRADLE_OPTS% -Dorg.gradle.appname=gradlew -classpath "%WRAPPER_JAR%" org.gradle.wrapper.GradleWrapperMain %*
EXIT /B %ERRORLEVEL%
