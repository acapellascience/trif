#!/usr/bin/env ruby
# Writes TrifProbe.xcodeproj for the browser probe (the project is kept in the repository, so this is only
# for when a file is added or renamed). Needs the xcodeproj gem: gem install xcodeproj
#
#   ruby mobile/browser-probe/make-project.rb
#
# The app's resources are the repository's own files, by reference: the kit and pages from mobile/shared, SES
# from extension/vendor, and the two generated files from mobile/shared/gen (node mobile/prepare.js).

require 'xcodeproj'

here = File.expand_path(__dir__)
path = File.join(here, 'TrifProbe.xcodeproj')
project = Xcodeproj::Project.new(path)
target = project.new_target(:application, 'TrifProbe', :ios, '17.0', nil, :swift)
# (the gem links Foundation by a path inside one particular SDK; Swift links what it imports without it)
target.frameworks_build_phase.clear
project.frameworks_group.clear

sources = project.main_group.new_group('TrifProbe', 'TrifProbe')
Dir[File.join(here, 'TrifProbe', '*.swift')].sort.each do |file|
  target.add_file_references([sources.new_file(File.basename(file))])
end

web = sources.new_group('Web', 'Web')
resources = Dir[File.join(here, 'TrifProbe', 'Web', '*.js')].sort.map { |file| web.new_file(File.basename(file)) }

shared = project.main_group.new_group('Shared (from the repository)')
[
  '../shared/kit.js',
  '../shared/gen/sandbox-runtime.js',
  '../shared/gen/browser-checks.json',
  '../../extension/vendor/ses.umd.min.js',
].each { |rel| resources << shared.new_file(rel) }
# (a folder reference: the pages stay a folder named "pages" inside the app)
pages = shared.new_file('../shared/pages')
pages.last_known_file_type = 'folder'
resources << pages
target.add_resources(resources)

target.build_configurations.each do |config|
  s = config.build_settings
  s['PRODUCT_BUNDLE_IDENTIFIER'] = 'com.timsrobot.trifprobe.browser'
  s['PRODUCT_NAME'] = '$(TARGET_NAME)'
  s['MARKETING_VERSION'] = '0.1'
  s['CURRENT_PROJECT_VERSION'] = '1'
  s['SWIFT_VERSION'] = '5.0'
  s['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0'
  s['TARGETED_DEVICE_FAMILY'] = '1,2'
  s['CODE_SIGN_STYLE'] = 'Automatic'
  s['GENERATE_INFOPLIST_FILE'] = 'YES'
  s['INFOPLIST_KEY_CFBundleDisplayName'] = 'TRIF Probe'
  s['INFOPLIST_KEY_UIApplicationSceneManifest_Generation'] = 'YES'
  s['INFOPLIST_KEY_UILaunchScreen_Generation'] = 'YES'
  s['INFOPLIST_KEY_UISupportedInterfaceOrientations'] = 'UIInterfaceOrientationPortrait UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight'
  s['INFOPLIST_KEY_UISupportedInterfaceOrientations_iPad'] = 'UIInterfaceOrientationPortrait UIInterfaceOrientationPortraitUpsideDown UIInterfaceOrientationLandscapeLeft UIInterfaceOrientationLandscapeRight'
  s['ENABLE_PREVIEWS'] = 'YES'
  s.delete('INFOPLIST_FILE')
  s.delete('ASSETCATALOG_COMPILER_APPICON_NAME')
end
project.build_configurations.each { |config| config.build_settings['IPHONEOS_DEPLOYMENT_TARGET'] = '17.0' }

project.save
scheme = Xcodeproj::XCScheme.new
scheme.add_build_target(target)
scheme.set_launch_target(target)
scheme.save_as(path, 'TrifProbe', true)
puts "wrote #{path}"
